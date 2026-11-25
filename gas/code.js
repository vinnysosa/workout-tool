var SPREADSHEET_ID = '1wKA_jCCdKhNKkqk1LNaVhY_z3NduDU6Wbcxo6Vwok-k';
var SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
var SESSION_SLIDE_THRESHOLD_MS = 60 * 24 * 60 * 60 * 1000;
var MAX_ACTIVE_SESSIONS = 5;
var MAX_FAILED_LOGINS = 5;
var LOCKOUT_SECONDS = 900; // 15 minutes

/**
 * Health check endpoint. Does NOT render workout data without authentication.
 */
function doGet() {
  return jsonResponse_({
    ok: true,
    service: 'Workout Buddy API',
    appUrl: 'https://vsworkout.sosa-life.com'
  });
}

/**
 * Authenticated JSON RPC endpoint for the Workout Buddy PWA.
 * Expects POST body as JSON (sent with Content-Type: text/plain;charset=utf-8 to avoid CORS preflight).
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

    // Every other action requires a valid session token
    if (!validateSession_(payload.token)) {
      return jsonResponse_({
        ok: false,
        code: 'UNAUTHORIZED',
        error: 'Please sign in to continue.'
      });
    }

    var ss = getSpreadsheet_();

    switch (action) {
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

/**
 * Verifies username/password against ScriptProperties.
 * If plaintext AUTH_PASS was added/updated in Project Settings > Script Properties,
 * automatically upgrades it to salted SHA-256 (AUTH_SALT + AUTH_PASS_HASH), deletes
 * plaintext AUTH_PASS, and invalidates prior sessions.
 */
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

/**
 * Manual utility callable from the Apps Script editor if locked out by rate limiting.
 */
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

/* ==========================================================================
 * Workout & Cardio Data Operations
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

/**
 * Manual utility callable from the Apps Script editor: rebuilds Latest by replaying Log.
 */
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
