var SPREADSHEET_ID = '1wKA_jCCdKhNKkqk1LNaVhY_z3NduDU6Wbcxo6Vwok-k';
var SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
var SESSION_SLIDE_THRESHOLD_MS = 60 * 24 * 60 * 60 * 1000;
var MAX_ACTIVE_SESSIONS = 5;
var MAX_FAILED_LOGINS = 5;
var LOCKOUT_SECONDS = 900; // 15 minutes

/**
 * Health check endpoint. Never exposes workout data without authentication.
 */
function doGet() {
  return jsonResponse_({
    ok: true,
    service: 'Workout Buddy API',
    version: '2.0.0',
    appUrl: 'https://vsworkout.sosa-life.com'
  });
}

/**
 * Authenticated JSON RPC endpoint for Workout Buddy v2 (/) and Classic v1 (/v1/).
 * Uses POST Content-Type: text/plain;charset=utf-8 to avoid CORS preflight.
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse_({ ok: false, code: 'BAD_REQUEST', error: 'Missing request body.' });
    }

    var payload;
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return jsonResponse_({ ok: false, code: 'BAD_JSON', error: 'Invalid JSON payload.' });
    }

    var action = String(payload.action || '');

    if (action === 'login') {
      return jsonResponse_(handleLogin_(payload));
    }

    if (action === 'logout') {
      revokeSession_(payload.token);
      return jsonResponse_({ ok: true });
    }

    if (!validateSession_(payload.token)) {
      return jsonResponse_({
        ok: false,
        code: 'UNAUTHORIZED',
        error: 'Please sign in to continue.'
      });
    }

    var ss = getSpreadsheet_();

    switch (action) {
      /* ===== v2 Endpoints (Exercises_v2, Log_v2, Cardio_v2) ===== */
      case 'v2_bootstrap':
        return jsonResponse_(v2Bootstrap_(ss));

      case 'v2_logWorkout':
        return jsonResponse_(v2LogWorkout_(ss, payload.data));

      case 'v2_selectVariant':
        return jsonResponse_(v2SelectVariant_(ss, payload));

      case 'v2_reorderSlots':
        return jsonResponse_(v2ReorderSlots_(ss, payload));

      case 'v2_addExercise':
        return jsonResponse_(v2AddExercise_(ss, payload.data));

      case 'v2_logCardio':
        return jsonResponse_(v2LogCardio_(ss, payload.data));

      case 'v2_history':
        return jsonResponse_(v2GetHistory_(ss, Number(payload.days) || 365));

      /* ===== v1 Classic Endpoints (Plan, Latest, Log, Cardio) ===== */
      case 'bootstrap':
        return jsonResponse_({
          ok: true,
          theme: getSavedTheme_(),
          plan: getPlanData_(ss),
          todayWorkout: getTodayData_(ss),
          todayCardio: getTodayCardio_(ss)
        });

      case 'history':
        var days = Number(payload.days) || 365;
        return jsonResponse_({
          ok: true,
          history: getHistoryData_(ss, days),
          cardioHistory: getCardioHistory_(ss, days),
          plan: getPlanData_(ss)
        });

      case 'logWorkout':
        if (!payload.data || !payload.data.name) {
          return jsonResponse_({ ok: false, code: 'BAD_REQUEST', error: 'Missing exercise data.' });
        }
        logWorkout_(ss, payload.data);
        return jsonResponse_({
          ok: true,
          plan: getPlanData_(ss),
          todayWorkout: getTodayData_(ss)
        });

      case 'logCardio':
        if (!payload.data || !payload.data.type) {
          return jsonResponse_({ ok: false, code: 'BAD_REQUEST', error: 'Missing cardio data.' });
        }
        logCardio_(ss, payload.data);
        return jsonResponse_({
          ok: true,
          todayCardio: getTodayCardio_(ss)
        });

      case 'saveTheme':
        saveTheme_(String(payload.theme || 'Purple'));
        return jsonResponse_({ ok: true });

      default:
        return jsonResponse_({ ok: false, code: 'UNKNOWN_ACTION', error: 'Unknown action: ' + action });
    }
  } catch (err) {
    return jsonResponse_({
      ok: false,
      code: err && err.code ? err.code : 'SERVER_ERROR',
      error: err && err.message ? err.message : String(err)
    });
  }
}

/* ==========================================================================
 * Authentication & Session Management (ScriptProperties + CacheService)
 * ========================================================================== */

function handleLogin_(payload) {
  var cache = CacheService.getScriptCache();
  var failCount = Number(cache.get('wb_login_fails') || '0');
  if (failCount >= MAX_FAILED_LOGINS) {
    return {
      ok: false,
      code: 'RATE_LIMITED',
      error: 'Too many failed sign-in attempts. Try again in 15 minutes.'
    };
  }

  var valid = verifyCredentials_(payload.username, payload.password);
  if (!valid) {
    cache.put('wb_login_fails', String(failCount + 1), LOCKOUT_SECONDS);
    return {
      ok: false,
      code: 'INVALID_CREDENTIALS',
      error: 'Incorrect username or password.'
    };
  }

  cache.remove('wb_login_fails');
  var session = issueSession_();
  return {
    ok: true,
    token: session.token,
    expiresAt: session.expiresAt,
    theme: getSavedTheme_()
  };
}

function verifyCredentials_(username, password) {
  var props = PropertiesService.getScriptProperties();
  var cfgUser = (props.getProperty('AUTH_USER') || '').trim();
  var plainPass = props.getProperty('AUTH_PASS');

  if (plainPass !== null && plainPass !== '') {
    var freshSalt = Utilities.getUuid();
    var freshHash = sha256Hex_(freshSalt + ':' + plainPass);
    props.setProperties({
      AUTH_SALT: freshSalt,
      AUTH_PASS_HASH: freshHash,
      AUTH_SESSIONS: '[]'
    });
    props.deleteProperty('AUTH_PASS');
  }

  var salt = props.getProperty('AUTH_SALT') || '';
  var expectedPassHash = props.getProperty('AUTH_PASS_HASH') || '';

  if (!cfgUser || !salt || !expectedPassHash) {
    var cfgErr = new Error(
      'Auth not configured yet. In Apps Script > Project Settings > Script Properties, add AUTH_USER and AUTH_PASS.'
    );
    cfgErr.code = 'AUTH_NOT_CONFIGURED';
    throw cfgErr;
  }

  var inputUserHash = sha256Hex_(String(username || '').trim().toLowerCase());
  var expectedUserHash = sha256Hex_(cfgUser.toLowerCase());
  var inputPassHash = sha256Hex_(salt + ':' + String(password || ''));

  var userOk = timingSafeEqual_(inputUserHash, expectedUserHash);
  var passOk = timingSafeEqual_(inputPassHash, expectedPassHash);
  return userOk && passOk;
}

function issueSession_() {
  var props = PropertiesService.getScriptProperties();
  var now = Date.now();
  var expiresAt = now + SESSION_TTL_MS;
  var token = Utilities.getUuid() + '-' + Utilities.getUuid();
  var tokenHash = sha256Hex_(token);

  var sessions = readSessions_(props, now);
  sessions.push({ h: tokenHash, exp: expiresAt });
  if (sessions.length > MAX_ACTIVE_SESSIONS) {
    sessions = sessions.slice(sessions.length - MAX_ACTIVE_SESSIONS);
  }
  props.setProperty('AUTH_SESSIONS', JSON.stringify(sessions));

  return { token: token, expiresAt: expiresAt };
}

function validateSession_(token) {
  if (!token || typeof token !== 'string' || token.length < 32) return false;
  var props = PropertiesService.getScriptProperties();
  var now = Date.now();
  var tokenHash = sha256Hex_(token);
  var sessions = readSessions_(props, now);

  var matched = false;
  var mutated = false;
  for (var i = 0; i < sessions.length; i++) {
    if (timingSafeEqual_(sessions[i].h, tokenHash)) {
      matched = true;
      if (sessions[i].exp - now < SESSION_SLIDE_THRESHOLD_MS) {
        sessions[i].exp = now + SESSION_TTL_MS;
        mutated = true;
      }
      break;
    }
  }

  if (mutated) {
    props.setProperty('AUTH_SESSIONS', JSON.stringify(sessions));
  }
  return matched;
}

function revokeSession_(token) {
  if (!token || typeof token !== 'string') return;
  var props = PropertiesService.getScriptProperties();
  var now = Date.now();
  var tokenHash = sha256Hex_(token);
  var sessions = readSessions_(props, now).filter(function(s) {
    return !timingSafeEqual_(s.h, tokenHash);
  });
  props.setProperty('AUTH_SESSIONS', JSON.stringify(sessions));
}

function readSessions_(props, now) {
  var raw = props.getProperty('AUTH_SESSIONS');
  if (!raw) return [];
  try {
    var parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(function(s) {
      return s && typeof s.h === 'string' && Number(s.exp) > now;
    });
  } catch (e) {
    return [];
  }
}

function clearLoginLockout() {
  CacheService.getScriptCache().remove('wb_login_fails');
  return 'Login lockout cleared.';
}

function sha256Hex_(input) {
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(input),
    Utilities.Charset.UTF_8
  );
  var out = '';
  for (var i = 0; i < digest.length; i++) {
    out += ('0' + (digest[i] & 0xff).toString(16)).slice(-2);
  }
  return out;
}

function timingSafeEqual_(a, b) {
  var sa = String(a || '');
  var sb = String(b || '');
  var len = Math.max(sa.length, sb.length);
  var diff = sa.length ^ sb.length;
  for (var i = 0; i < len; i++) {
    diff |= (sa.charCodeAt(i) || 0) ^ (sb.charCodeAt(i) || 0);
  }
  return diff === 0 && sa.length > 0;
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSpreadsheet_() {
  return SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(SPREADSHEET_ID);
}

function fmtDate_(val, tz, pattern) {
  if (!val) return '';
  try {
    var d = val instanceof Date ? val : new Date(val);
    if (isNaN(d.getTime())) return '';
    return Utilities.formatDate(d, tz, pattern);
  } catch (e) {
    return '';
  }
}

/* ==========================================================================
 * v2 Backend Operations (Exercises_v2, Log_v2, Cardio_v2)
 * ========================================================================== */

/**
 * Exercises_v2 columns (1-indexed 1..16):
 * 0:SlotId | 1:Status | 2:Group | 3:Order | 4:Muscle | 5:Exercise | 6:IsSelected |
 * 7:GoalSets | 8:GoalReps | 9:StartWeight | 10:LastSets | 11:LastReps | 12:LastWeight |
 * 13:LastDate | 14:CleanStreak | 15:StickyNote
 */
function v2ReadExercises_(ss) {
  var sheet = ss.getSheetByName('Exercises_v2');
  if (!sheet) throw new Error("Missing 'Exercises_v2' tab.");
  var tz = Session.getScriptTimeZone();
  var values = sheet.getDataRange().getValues();
  values.shift();

  return values
    .filter(function(r) { return r[0] && r[1] === 'Active'; })
    .map(function(r) {
      var lastDateIso = fmtDate_(r[13], tz, 'yyyy-MM-dd');
      var lastDateShort = fmtDate_(r[13], tz, 'MMM d');
      var sel = r[6] === true || String(r[6]).toUpperCase() === 'TRUE';
      return {
        slotId: String(r[0]),
        group: String(r[2]),
        order: Number(r[3]) || 1,
        muscle: String(r[4]),
        exercise: String(r[5]),
        isSelected: sel,
        goalSets: Number(r[7]) || 3,
        goalReps: Number(r[8]) || 12,
        startWeight: Number(r[9]) || 0,
        lastSets: Number(r[10]) || Number(r[7]) || 3,
        lastReps: Number(r[11]) || Number(r[8]) || 12,
        lastWeight: Number(r[12]) || 0,
        lastDate: lastDateIso,
        lastDateShort: lastDateShort,
        cleanStreak: Number(r[14]) || 0,
        stickyNote: String(r[15] || '')
      };
    });
}

function v2ReadTodayAndSuggested_(ss, exercises) {
  var sheet = ss.getSheetByName('Log_v2');
  var tz = Session.getScriptTimeZone();
  var todayStr = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var todayWorkout = [];
  var lastGroupDate = {};

  if (sheet && sheet.getLastRow() > 1) {
    var rows = sheet.getDataRange().getValues();
    rows.shift();
    var seenKey = {};

    for (var i = rows.length - 1; i >= 0; i--) {
      var r = rows[i];
      var dStr = fmtDate_(r[0], tz, 'yyyy-MM-dd');
      if (!dStr) continue;
      var grp = String(r[1] || '');
      if (grp && !lastGroupDate[grp]) {
        lastGroupDate[grp] = dStr;
      }
      if (dStr === todayStr && r[4]) {
        var key = String(r[2]) + '::' + String(r[4]);
        if (!seenKey[key]) {
          seenKey[key] = true;
          todayWorkout.unshift({
            group: grp,
            slotId: String(r[2]),
            muscle: String(r[3]),
            exercise: String(r[4]),
            sets: Number(r[5]) || 0,
            reps: Number(r[6]) || 0,
            weight: Number(r[7]) || 0,
            effort: String(r[8] || 'clean'),
            note: String(r[9] || '')
          });
        }
      }
    }
  }

  // Auto-select today's group if already active today; otherwise pick least-recently-trained split
  var groups = [];
  var seenG = {};
  exercises.forEach(function(ex) {
    if (!seenG[ex.group]) { seenG[ex.group] = true; groups.push(ex.group); }
  });

  var suggestedGroup = groups[0] || '';
  if (todayWorkout.length > 0 && todayWorkout[todayWorkout.length - 1].group) {
    suggestedGroup = todayWorkout[todayWorkout.length - 1].group;
  } else if (groups.length > 0) {
    groups.sort(function(a, b) {
      var da = lastGroupDate[a] || '0000-00-00';
      var db = lastGroupDate[b] || '0000-00-00';
      return da.localeCompare(db);
    });
    suggestedGroup = groups[0];
  }

  return { todayWorkout: todayWorkout, suggestedGroup: suggestedGroup };
}

function v2ReadCardioState_(ss) {
  var sheet = ss.getSheetByName('Cardio_v2');
  var tz = Session.getScriptTimeZone();
  var todayStr = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var todayCardio = [];
  var lastCardio = {};

  if (sheet && sheet.getLastRow() > 1) {
    var rows = sheet.getDataRange().getValues();
    rows.shift();
    for (var i = rows.length - 1; i >= 0; i--) {
      var r = rows[i];
      var machine = String(r[1] || '');
      if (!machine) continue;
      var dStr = fmtDate_(r[0], tz, 'yyyy-MM-dd');
      var item = {
        date: dStr,
        machine: machine,
        minutes: r[2] === '' ? '' : Number(r[2]),
        avgWatts: r[3] === '' ? '' : Number(r[3]),
        peakWatts: r[4] === '' ? '' : Number(r[4]),
        miles: r[5] === '' ? '' : Number(r[5]),
        calories: r[6] === '' ? '' : Number(r[6]),
        floors: r[7] === '' ? '' : Number(r[7]),
        level: r[8] === '' ? '' : Number(r[8]),
        note: String(r[9] || '')
      };
      if (!lastCardio[machine]) lastCardio[machine] = item;
      if (dStr === todayStr) todayCardio.unshift(item);
    }
  }

  return { todayCardio: todayCardio, lastCardio: lastCardio };
}

function v2Bootstrap_(ss) {
  var exercises = v2ReadExercises_(ss);
  var workoutState = v2ReadTodayAndSuggested_(ss, exercises);
  var cardioState = v2ReadCardioState_(ss);
  return {
    ok: true,
    exercises: exercises,
    todayWorkout: workoutState.todayWorkout,
    suggestedGroup: workoutState.suggestedGroup,
    todayCardio: cardioState.todayCardio,
    lastCardio: cardioState.lastCardio
  };
}

function v2LogWorkout_(ss, data) {
  if (!data || !data.slotId || !data.exercise) {
    return { ok: false, code: 'BAD_REQUEST', error: 'Missing slotId or exercise.' };
  }

  var exSheet = ss.getSheetByName('Exercises_v2');
  var logSheet = ss.getSheetByName('Log_v2');
  if (!exSheet || !logSheet) throw new Error('Missing v2 sheets.');

  var now = new Date();
  var tz = Session.getScriptTimeZone();
  var todayStr = Utilities.formatDate(now, tz, 'yyyy-MM-dd');

  var sets = Number(data.sets) || 0;
  var reps = Number(data.reps) || 0;
  var weight = Number(data.weight) || 0;
  var effort = String(data.effort || 'clean');
  var note = String(data.note || '');

  // Update Exercises_v2 row & sibling selection
  var exValues = exSheet.getDataRange().getValues();
  var group = String(data.group || '');
  var muscle = String(data.muscle || '');

  for (var r = 1; r < exValues.length; r++) {
    var row = exValues[r];
    if (String(row[0]) !== String(data.slotId)) continue;

    if (String(row[5]) === String(data.exercise)) {
      group = String(row[2]);
      muscle = String(row[4]);
      var goalSets = Number(row[7]) || 3;
      var goalReps = Number(row[8]) || 12;
      var startWeight = Number(row[9]) || 0;
      var prevWeight = Number(row[12]) || 0;
      var prevStreak = Number(row[14]) || 0;

      if (startWeight <= 0 && weight > 0) startWeight = weight;

      var newStreak = 0;
      if (effort === 'clean' && sets >= goalSets && reps >= goalReps) {
        newStreak = (weight === prevWeight) ? (prevStreak + 1) : 1;
      }

      exSheet.getRange(r + 1, 7, 1, 10).setValues([[
        true, goalSets, goalReps, startWeight, sets, reps, weight, todayStr, newStreak, note
      ]]);
    } else if (row[6] === true || String(row[6]).toUpperCase() === 'TRUE') {
      exSheet.getRange(r + 1, 7).setValue(false);
    }
  }

  // Upsert today's entry in Log_v2 for (today, slotId, exercise)
  var logValues = logSheet.getDataRange().getValues();
  var updatedExisting = false;
  for (var i = logValues.length - 1; i >= 1; i--) {
    var lr = logValues[i];
    if (String(lr[2]) === String(data.slotId) && String(lr[4]) === String(data.exercise)) {
      if (fmtDate_(lr[0], tz, 'yyyy-MM-dd') === todayStr) {
        logSheet.getRange(i + 1, 1, 1, 10).setValues([[
          now, group, data.slotId, muscle, data.exercise, sets, reps, weight, effort, note
        ]]);
        updatedExisting = true;
        break;
      }
    }
  }

  if (!updatedExisting) {
    logSheet.appendRow([now, group, data.slotId, muscle, data.exercise, sets, reps, weight, effort, note]);
  }

  var exercises = v2ReadExercises_(ss);
  var workoutState = v2ReadTodayAndSuggested_(ss, exercises);
  return {
    ok: true,
    exercises: exercises,
    todayWorkout: workoutState.todayWorkout
  };
}

function v2SelectVariant_(ss, payload) {
  var slotId = String(payload.slotId || '');
  var exercise = String(payload.exercise || '');
  if (!slotId || !exercise) {
    return { ok: false, code: 'BAD_REQUEST', error: 'Missing slotId or exercise.' };
  }

  var sheet = ss.getSheetByName('Exercises_v2');
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === slotId) {
      var match = String(values[i][5]) === exercise;
      sheet.getRange(i + 1, 7).setValue(match);
    }
  }
  return { ok: true };
}

function v2ReorderSlots_(ss, payload) {
  var group = String(payload.group || '');
  var slotOrder = payload.slotOrder;
  if (!group || !Array.isArray(slotOrder) || !slotOrder.length) {
    return { ok: false, code: 'BAD_REQUEST', error: 'Invalid reorder payload.' };
  }

  var orderMap = {};
  slotOrder.forEach(function(id, idx) {
    orderMap[String(id)] = idx + 1;
  });

  var sheet = ss.getSheetByName('Exercises_v2');
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][2]) === group) {
      var sid = String(values[i][0]);
      if (orderMap[sid] !== undefined && Number(values[i][3]) !== orderMap[sid]) {
        sheet.getRange(i + 1, 4).setValue(orderMap[sid]);
      }
    }
  }
  return { ok: true };
}

function v2AddExercise_(ss, data) {
  if (!data || !data.exercise) {
    return { ok: false, code: 'BAD_REQUEST', error: 'Exercise name is required.' };
  }

  var sheet = ss.getSheetByName('Exercises_v2');
  var values = sheet.getDataRange().getValues();
  var exName = String(data.exercise).trim();
  var mode = String(data.mode || 'slot');
  var goalSets = Number(data.goalSets) || 3;
  var goalReps = Number(data.goalReps) || 12;
  var startWeight = Number(data.startWeight) || 0;
  var note = String(data.note || '').trim();

  var slotId = '';
  var group = String(data.group || '').trim();
  var muscle = String(data.muscle || '').trim();
  var order = 1;

  if (mode === 'variant' && data.slotId) {
    slotId = String(data.slotId);
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][0]) === slotId) {
        group = String(values[i][2]);
        order = Number(values[i][3]) || 1;
        muscle = String(values[i][4]);
        if (String(values[i][5]).toLowerCase() === exName.toLowerCase()) {
          return { ok: false, code: 'DUPLICATE', error: 'That variant already exists in this slot.' };
        }
        sheet.getRange(i + 1, 7).setValue(false);
      }
    }
  } else {
    if (!group || !muscle) {
      return { ok: false, code: 'BAD_REQUEST', error: 'Group and muscle are required.' };
    }
    var maxOrder = 0;
    for (var j = 1; j < values.length; j++) {
      if (String(values[j][2]) === group) {
        maxOrder = Math.max(maxOrder, Number(values[j][3]) || 0);
      }
    }
    order = maxOrder + 1;
    var slug = muscle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'slot';
    slotId = slug + '-' + Utilities.getUuid().slice(0, 6);
  }

  sheet.appendRow([
    slotId, 'Active', group, order, muscle, exName, true,
    goalSets, goalReps, startWeight, goalSets, goalReps, startWeight,
    '', 0, note
  ]);

  return {
    ok: true,
    slotId: slotId,
    exercises: v2ReadExercises_(ss)
  };
}

function v2LogCardio_(ss, data) {
  if (!data || !data.machine) {
    return { ok: false, code: 'BAD_REQUEST', error: 'Missing cardio machine.' };
  }

  var sheet = ss.getSheetByName('Cardio_v2');
  if (!sheet) throw new Error("Missing 'Cardio_v2' tab.");

  var now = new Date();
  var tz = Session.getScriptTimeZone();
  var todayStr = Utilities.formatDate(now, tz, 'yyyy-MM-dd');

  var numOrBlank = function(v) {
    if (v === '' || v === null || v === undefined) return '';
    var n = Number(v);
    return isNaN(n) ? '' : n;
  };

  var rowVals = [
    now,
    String(data.machine),
    numOrBlank(data.minutes),
    numOrBlank(data.avgWatts),
    numOrBlank(data.peakWatts),
    numOrBlank(data.miles),
    numOrBlank(data.calories),
    numOrBlank(data.floors),
    numOrBlank(data.level),
    String(data.note || '')
  ];

  var values = sheet.getDataRange().getValues();
  var updated = false;
  for (var i = values.length - 1; i >= 1; i--) {
    if (String(values[i][1]) === String(data.machine)) {
      if (fmtDate_(values[i][0], tz, 'yyyy-MM-dd') === todayStr) {
        sheet.getRange(i + 1, 1, 1, 10).setValues([rowVals]);
        updated = true;
        break;
      }
    }
  }
  if (!updated) {
    sheet.appendRow(rowVals);
  }

  var cardioState = v2ReadCardioState_(ss);
  return {
    ok: true,
    todayCardio: cardioState.todayCardio,
    lastCardio: cardioState.lastCardio
  };
}

function v2GetHistory_(ss, days) {
  var tz = Session.getScriptTimeZone();
  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (days || 365));

  var exercises = v2ReadExercises_(ss);
  var logSheet = ss.getSheetByName('Log_v2');
  var cardioSheet = ss.getSheetByName('Cardio_v2');

  var baselines = {}; // exercise -> { weight, sets, reps, work, date }
  var history = [];

  if (logSheet && logSheet.getLastRow() > 1) {
    var lRows = logSheet.getDataRange().getValues();
    lRows.shift();
    lRows.forEach(function(r) {
      if (!r[0] || !r[4]) return;
      var dt = r[0] instanceof Date ? r[0] : new Date(r[0]);
      if (isNaN(dt.getTime())) return;
      var dStr = Utilities.formatDate(dt, tz, 'yyyy-MM-dd');
      var tStr = Utilities.formatDate(dt, tz, 'h:mm a');
      var ex = String(r[4]);
      var sets = Number(r[5]) || 0;
      var reps = Number(r[6]) || 0;
      var weight = Number(r[7]) || 0;
      var work = sets * reps * (weight > 0 ? weight : 1);

      if (!baselines[ex]) {
        baselines[ex] = {
          date: dStr,
          sets: sets,
          reps: reps,
          weight: weight,
          work: work
        };
      }

      if (dt >= cutoff) {
        history.push({
          date: dStr,
          time: tStr,
          group: String(r[1] || ''),
          slotId: String(r[2] || ''),
          muscle: String(r[3] || ''),
          exercise: ex,
          sets: sets,
          reps: reps,
          weight: weight,
          effort: String(r[8] || 'clean'),
          note: String(r[9] || '')
        });
      }
    });
  }

  var cardioHistory = [];
  if (cardioSheet && cardioSheet.getLastRow() > 1) {
    var cRows = cardioSheet.getDataRange().getValues();
    cRows.shift();
    cRows.forEach(function(r) {
      if (!r[0] || !r[1]) return;
      var dt = r[0] instanceof Date ? r[0] : new Date(r[0]);
      if (isNaN(dt.getTime()) || dt < cutoff) return;
      cardioHistory.push({
        date: Utilities.formatDate(dt, tz, 'yyyy-MM-dd'),
        time: Utilities.formatDate(dt, tz, 'h:mm a'),
        machine: String(r[1]),
        minutes: r[2] === '' ? null : Number(r[2]),
        avgWatts: r[3] === '' ? null : Number(r[3]),
        peakWatts: r[4] === '' ? null : Number(r[4]),
        miles: r[5] === '' ? null : Number(r[5]),
        calories: r[6] === '' ? null : Number(r[6]),
        floors: r[7] === '' ? null : Number(r[7]),
        level: r[8] === '' ? null : Number(r[8]),
        note: String(r[9] || '')
      });
    });
  }

  return {
    ok: true,
    exercises: exercises,
    baselines: baselines,
    history: history,
    cardioHistory: cardioHistory
  };
}

/* ==========================================================================
 * v1 Classic Workout & Cardio Operations (Untouched Backup Support for /v1/)
 * ========================================================================== */

function getSavedTheme_() {
  var scriptTheme = PropertiesService.getScriptProperties().getProperty('wb-theme');
  if (scriptTheme) return scriptTheme;
  try {
    var userTheme = PropertiesService.getUserProperties().getProperty('wb-theme');
    if (userTheme) return userTheme;
  } catch (e) {}
  return 'Purple';
}

function saveTheme_(name) {
  PropertiesService.getScriptProperties().setProperty('wb-theme', name);
  try {
    PropertiesService.getUserProperties().setProperty('wb-theme', name);
  } catch (e) {}
}

function getPlanData_(ss) {
  var planSheet = ss.getSheetByName('Plan');
  if (!planSheet) throw new Error("Could not find 'Plan' tab.");

  var planData = planSheet.getDataRange().getValues();
  planData.shift();

  var latestData = {};
  var latestSheet = ss.getSheetByName('Latest');
  if (latestSheet && latestSheet.getLastRow() > 1) {
    var rows = latestSheet.getDataRange().getValues();
    rows.shift();
    rows.forEach(function(row) {
      if (row[0]) {
        latestData[row[0]] = {
          sets: row[1],
          reps: row[2],
          weight: row[3],
          date: row[4],
          failedSets: String(row[5] || ''),
          note: row[6] || ''
        };
      }
    });
  }

  var tz = Session.getScriptTimeZone();

  return planData
    .filter(function(row) { return row[0] === 'Active'; })
    .map(function(row) {
      var name = row[3];
      var latest = latestData[name];
      var videoSearch = 'https://www.youtube.com/results?search_query=Planet+Fitness+' + encodeURIComponent(name);
      var lastDateStr = null;
      if (latest && latest.date) {
        try {
          lastDateStr = Utilities.formatDate(new Date(latest.date), tz, 'MMM d');
        } catch (e) {}
      }
      return {
        group: row[1],
        order: row[2],
        name: name,
        setsGoal: row[4],
        repsGoal: row[5],
        startWeight: row[6],
        lastSets: latest ? latest.sets : row[4],
        lastReps: latest ? latest.reps : row[5],
        lastWeight: latest ? latest.weight : row[6],
        lastDate: lastDateStr,
        lastFailedSets: latest ? (latest.failedSets || '') : '',
        lastNote: latest ? (latest.note || '') : '',
        description: row[7],
        tips: row[8],
        video: videoSearch,
        alternatives: row[9] || ''
      };
    })
    .sort(function(a, b) { return a.order - b.order; });
}

function logWorkout_(ss, data) {
  var logSheet = ss.getSheetByName('Log');
  var now = new Date();
  var tz = Session.getScriptTimeZone();
  var todayStr = Utilities.formatDate(now, tz, 'yyyy-MM-dd');

  if (logSheet.getLastRow() === 0) {
    logSheet.appendRow(['Timestamp', 'Exercise', 'Sets Done', 'Reps Done', 'Weight Used', 'Failed Sets', 'Note']);
  }

  var sets = Number(data.sets) || 0;
  var reps = Number(data.reps) || 0;
  var weight = Number(data.weight) || 0;
  var failedSets = String(data.failedSets || '');
  var note = String(data.note || '');

  var logData = logSheet.getDataRange().getValues();
  for (var i = 1; i < logData.length; i++) {
    if (logData[i][1] === data.name) {
      try {
        var rowDate = Utilities.formatDate(new Date(logData[i][0]), tz, 'yyyy-MM-dd');
        if (rowDate === todayStr) {
          logSheet.getRange(i + 1, 1, 1, 7).setValues([[now, data.name, sets, reps, weight, failedSets, note]]);
          upsertLatest_(ss, data.name, sets, reps, weight, now, failedSets, note);
          return 'Success!';
        }
      } catch (e) {}
    }
  }

  logSheet.appendRow([now, data.name, sets, reps, weight, failedSets, note]);
  upsertLatest_(ss, data.name, sets, reps, weight, now, failedSets, note);
  return 'Success!';
}

function upsertLatest_(ss, exercise, sets, reps, weight, date, failedSets, note) {
  var sheet = ss.getSheetByName('Latest');
  if (!sheet) {
    sheet = ss.insertSheet('Latest');
    sheet.appendRow(['Exercise', 'Sets', 'Reps', 'Weight', 'Date', 'Failed Sets', 'Note']);
  }

  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === exercise) {
      sheet.getRange(i + 1, 1, 1, 7).setValues([[exercise, sets, reps, weight, date, failedSets || '', note || '']]);
      return;
    }
  }
  sheet.appendRow([exercise, sets, reps, weight, date, failedSets || '', note || '']);
}

function backfillLatest() {
  var ss = getSpreadsheet_();
  var logSheet = ss.getSheetByName('Log');
  if (!logSheet || logSheet.getLastRow() <= 1) return 'No log data to backfill.';

  var logData = logSheet.getDataRange().getValues();
  logData.shift();
  logData.forEach(function(row) {
    if (row[1]) upsertLatest_(ss, row[1], row[2], row[3], row[4], row[0], row[5] || '', row[6] || '');
  });
  return 'Backfill complete!';
}

function getHistoryData_(ss, days) {
  var logSheet = ss.getSheetByName('Log');
  if (!logSheet || logSheet.getLastRow() <= 1) return [];

  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (days || 365));
  var tz = Session.getScriptTimeZone();

  var logData = logSheet.getDataRange().getValues();
  logData.shift();

  return logData
    .filter(function(row) { return new Date(row[0]) >= cutoff; })
    .map(function(row) {
      return {
        date: Utilities.formatDate(new Date(row[0]), tz, 'yyyy-MM-dd'),
        exercise: row[1],
        sets: row[2],
        reps: row[3],
        weight: row[4],
        failedSets: String(row[5] || ''),
        note: row[6] || ''
      };
    });
}

function getTodayData_(ss) {
  var logSheet = ss.getSheetByName('Log');
  if (!logSheet || logSheet.getLastRow() <= 1) return [];

  var tz = Session.getScriptTimeZone();
  var todayStr = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

  var logData = logSheet.getDataRange().getValues();
  logData.shift();

  var seen = {};
  var results = [];
  for (var i = logData.length - 1; i >= 0; i--) {
    var row = logData[i];
    try {
      var rowDate = Utilities.formatDate(new Date(row[0]), tz, 'yyyy-MM-dd');
      if (rowDate === todayStr && row[1] && !seen[row[1]]) {
        seen[row[1]] = true;
        results.unshift({ name: row[1], sets: row[2], reps: row[3], weight: row[4] });
      }
    } catch (e) {}
  }
  return results;
}

function logCardio_(ss, data) {
  var sheet = ss.getSheetByName('Cardio');
  if (!sheet) {
    sheet = ss.insertSheet('Cardio');
    sheet.appendRow(['Timestamp', 'Type', 'Intensity', 'Minutes', 'Note']);
  }

  var now = new Date();
  var tz = Session.getScriptTimeZone();
  var todayStr = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  var intensity = String(data.intensity || '');
  var minutes = Number(data.minutes) || 0;
  var note = String(data.note || '');

  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][1] === data.type) {
      try {
        var rowDate = Utilities.formatDate(new Date(rows[i][0]), tz, 'yyyy-MM-dd');
        if (rowDate === todayStr) {
          sheet.getRange(i + 1, 1, 1, 5).setValues([[now, data.type, intensity, minutes, note]]);
          return 'Success!';
        }
      } catch (e) {}
    }
  }

  sheet.appendRow([now, data.type, intensity, minutes, note]);
  return 'Success!';
}

function getTodayCardio_(ss) {
  var sheet = ss.getSheetByName('Cardio');
  if (!sheet || sheet.getLastRow() <= 1) return [];

  var tz = Session.getScriptTimeZone();
  var todayStr = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

  var rows = sheet.getDataRange().getValues();
  rows.shift();

  return rows
    .filter(function(row) {
      try { return Utilities.formatDate(new Date(row[0]), tz, 'yyyy-MM-dd') === todayStr; }
      catch (e) { return false; }
    })
    .map(function(row) {
      return { type: row[1], intensity: row[2], minutes: row[3], note: row[4] || '' };
    });
}

function getCardioHistory_(ss, days) {
  var sheet = ss.getSheetByName('Cardio');
  if (!sheet || sheet.getLastRow() <= 1) return [];

  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (days || 365));
  var tz = Session.getScriptTimeZone();

  var rows = sheet.getDataRange().getValues();
  rows.shift();

  return rows
    .filter(function(row) {
      try { return new Date(row[0]) >= cutoff; }
      catch (e) { return false; }
    })
    .map(function(row) {
      return {
        date: Utilities.formatDate(new Date(row[0]), tz, 'yyyy-MM-dd'),
        type: row[1],
        intensity: row[2] || '',
        minutes: row[3],
        note: row[4] || ''
      };
    });
}
