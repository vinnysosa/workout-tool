(function() {
  'use strict';

  var STORAGE_TOKEN_KEY = 'wb_session_token';
  var STORAGE_THEME_KEY = 'wb-theme';

  var themes = {
    'Purple':        { primary: '#4a148c', 'primary-light': '#f3e5f5', accent: '#f06292', 'accent-light': '#fce4ec', bg: '#f5f4f7', card: '#fff', text: '#333', muted: '#999', swatch: '#4a148c' },
    'Blue':          { primary: '#0d47a1', 'primary-light': '#e3f2fd', accent: '#42a5f5', 'accent-light': '#bbdefb', bg: '#f4f6fa', card: '#fff', text: '#333', muted: '#999', swatch: '#0d47a1' },
    'Orange':        { primary: '#e65100', 'primary-light': '#fff3e0', accent: '#ff9800', 'accent-light': '#ffe0b2', bg: '#faf8f4', card: '#fff', text: '#333', muted: '#999', swatch: '#e65100' },
    'Green':         { primary: '#1b5e20', 'primary-light': '#e8f5e9', accent: '#66bb6a', 'accent-light': '#c8e6c9', bg: '#f4faf4', card: '#fff', text: '#333', muted: '#999', swatch: '#1b5e20' },
    'Grey':          { primary: '#37474f', 'primary-light': '#eceff1', accent: '#78909c', 'accent-light': '#cfd8dc', bg: '#f4f5f6', card: '#fff', text: '#333', muted: '#999', swatch: '#37474f' },
    'Black & White': { primary: '#111111', 'primary-light': '#eeeeee', accent: '#555555', 'accent-light': '#dddddd', bg: '#f5f5f5', card: '#fff', text: '#111', muted: '#888', swatch: '#111111' },
    'High Contrast': { primary: '#000000', 'primary-light': '#ffff00', accent: '#ff0000', 'accent-light': '#ffcccc', bg: '#ffffff', card: '#fff', text: '#000', muted: '#333', swatch: '#ff0000' }
  };

  var chartColors = [
    '#f06292', '#42a5f5', '#66bb6a', '#ff9800',
    '#ab47bc', '#26c6da', '#ef5350', '#8d6e63',
    '#78909c', '#ffca28', '#5c6bc0', '#ec407a'
  ];

  /* ===== State ===== */
  var currentPage = 'workout'; // 'workout' | 'history'
  var currentTheme = 'Purple';
  var planData = [];
  var sessionLog = [];
  var cardioLog = [];
  var selectedGroup = '';
  var activeTimers = {};

  var historyLoaded = false;
  var currentHistoryView = 'log'; // 'log' | 'exercise' | 'charts'
  var currentDays = 30;
  var allHistory = [];
  var allCardioHistory = [];
  var progressChart = null;

  /* ===== Safe HTML Escape ===== */
  function esc(val) {
    return String(val == null ? '' : val)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ===== Storage Helpers ===== */
  function getToken() {
    try { return localStorage.getItem(STORAGE_TOKEN_KEY) || ''; }
    catch (e) { return ''; }
  }

  function setToken(token) {
    try {
      if (token) localStorage.setItem(STORAGE_TOKEN_KEY, token);
      else localStorage.removeItem(STORAGE_TOKEN_KEY);
    } catch (e) {}
  }

  function getCachedTheme() {
    try { return localStorage.getItem(STORAGE_THEME_KEY) || 'Purple'; }
    catch (e) { return 'Purple'; }
  }

  function setCachedTheme(name) {
    try { localStorage.setItem(STORAGE_THEME_KEY, name); }
    catch (e) {}
  }

  /* ===== API Client (POST text/plain avoids GAS CORS preflight) ===== */
  async function apiCall(action, extra) {
    var cfg = window.WORKOUT_CONFIG || {};
    if (!cfg.GAS_API_URL) {
      throw new Error('Missing GAS_API_URL in config.js');
    }

    var body = Object.assign({ action: action }, extra || {});
    if (action !== 'login') {
      body.token = getToken();
    }

    var res = await fetch(cfg.GAS_API_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      throw new Error('Network error (' + res.status + ')');
    }

    var json = await res.json();
    if (!json.ok) {
      if (json.code === 'UNAUTHORIZED') {
        showAuthGate('Session expired. Please sign in again.');
      }
      var err = new Error(json.error || 'Request failed.');
      err.code = json.code || 'ERROR';
      throw err;
    }
    return json;
  }

  /* ===== Theme System ===== */
  function applyTheme(name) {
    var t = themes[name] ? themes[name] : themes.Purple;
    var resolved = themes[name] ? name : 'Purple';
    currentTheme = resolved;

    var root = document.documentElement;
    root.style.setProperty('--primary', t.primary);
    root.style.setProperty('--primary-light', t['primary-light']);
    root.style.setProperty('--accent', t.accent);
    root.style.setProperty('--accent-light', t['accent-light']);
    root.style.setProperty('--bg', t.bg);
    root.style.setProperty('--card', t.card);
    root.style.setProperty('--text', t.text);
    root.style.setProperty('--muted', t.muted);

    var metaTheme = document.getElementById('metaThemeColor');
    if (metaTheme) metaTheme.setAttribute('content', t.primary);

    setCachedTheme(resolved);
    renderThemeMenu();
  }

  function renderThemeMenu() {
    var container = document.getElementById('themeOptions');
    if (!container) return;
    container.innerHTML = '';

    Object.keys(themes).forEach(function(name) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'theme-option' + (name === currentTheme ? ' active' : '');

      var swatch = document.createElement('span');
      swatch.className = 'theme-swatch';
      swatch.style.background = themes[name].swatch;

      var label = document.createElement('span');
      label.textContent = name;

      btn.appendChild(swatch);
      btn.appendChild(label);
      btn.addEventListener('click', function() {
        applyTheme(name);
        closeDropdown();
        if (getToken()) {
          apiCall('saveTheme', { theme: name }).catch(function() {});
        }
      });
      container.appendChild(btn);
    });
  }

  function syncMenuDivider() {
    var installBtn = document.getElementById('installAppBtn');
    var signOutBtn = document.getElementById('signOutBtn');
    var divider = document.getElementById('menuActionDivider');
    var anyVisible = (installBtn && !installBtn.hidden) || (signOutBtn && !signOutBtn.hidden);
    if (divider) divider.hidden = !anyVisible;
  }

  function closeDropdown() {
    var dd = document.getElementById('themeDropdown');
    if (dd) dd.classList.remove('open');
  }

  /* ===== Auth Gate & App Shell Switching ===== */
  function showAuthGate(errorMessage) {
    setToken('');
    document.getElementById('appShell').hidden = true;
    document.getElementById('authGate').hidden = false;
    document.getElementById('signOutBtn').hidden = true;
    document.getElementById('pageTitle').textContent = 'Workout Buddy';
    syncMenuDivider();

    var errEl = document.getElementById('loginError');
    if (errorMessage) {
      errEl.textContent = errorMessage;
      errEl.hidden = false;
    } else {
      errEl.textContent = '';
      errEl.hidden = true;
    }
  }

  function showAppShell() {
    document.getElementById('authGate').hidden = true;
    document.getElementById('appShell').hidden = false;
    document.getElementById('signOutBtn').hidden = false;
    syncMenuDivider();
    updatePageDisplay();
  }

  /* ===== Top-Level Page Navigation (Workout <-> Progress) ===== */
  function switchPage(target, pushHistory) {
    currentPage = target === 'history' ? 'history' : 'workout';
    updatePageDisplay();

    if (pushHistory !== false) {
      var url = currentPage === 'history' ? '?page=history' : window.location.pathname;
      try { window.history.pushState({ page: currentPage }, '', url); } catch (e) {}
    }

    if (currentPage === 'history' && !historyLoaded && getToken()) {
      loadHistoryData();
    } else if (currentPage === 'history') {
      renderActiveHistoryView();
    }
  }

  function updatePageDisplay() {
    var isHist = currentPage === 'history';
    document.getElementById('workoutPage').hidden = isHist;
    document.getElementById('historyPage').hidden = !isHist;
    document.getElementById('pageTitle').textContent = isHist ? 'Progress History' : 'Workout Buddy';
    document.getElementById('pageToggleBtn').innerHTML = isHist ? '&larr; Back to Workout' : 'View Progress &rarr;';
  }

  /* ===== Bootstrap & Data Loading ===== */
  async function loadBootstrap() {
    showAppShell();
    var exList = document.getElementById('exerciseList');
    if (!planData.length) {
      exList.innerHTML = '<div class="loading">Loading workout plan&hellip;</div>';
    }

    try {
      var data = await apiCall('bootstrap');
      if (data.theme && themes[data.theme]) {
        applyTheme(data.theme);
      }
      planData = data.plan || [];
      sessionLog = data.todayWorkout || [];
      cardioLog = data.todayCardio || [];

      renderGroupTabs();
      renderExercises();
      renderCardioToday();
      renderSessionSummary();
      populateChartGroupSelect();

      if (currentPage === 'history') {
        loadHistoryData();
      }
    } catch (err) {
      if (err.code !== 'UNAUTHORIZED') {
        exList.innerHTML = '<div class="empty-state">' + esc(err.message || 'Could not load workout data.') + '</div>';
      }
    }
  }

  async function loadHistoryData() {
    var histEl = document.getElementById('historyContent');
    histEl.innerHTML = '<div class="loading">Loading&hellip;</div>';

    try {
      var res = await apiCall('history', { days: 365 });
      allHistory = res.history || [];
      allCardioHistory = res.cardioHistory || [];
      if (res.plan && res.plan.length) {
        planData = res.plan;
        populateChartGroupSelect();
      }
      historyLoaded = true;
      renderActiveHistoryView();
    } catch (err) {
      if (err.code !== 'UNAUTHORIZED') {
        histEl.innerHTML = '<div class="empty-state">' + esc(err.message || 'Could not load history.') + '</div>';
      }
    }
  }

  /* ===== Workout Logger UI ===== */
  function renderGroupTabs() {
    var tabsEl = document.getElementById('groupTabs');
    tabsEl.innerHTML = '';

    var groups = [];
    var seen = {};
    planData.forEach(function(item) {
      if (!seen[item.group]) {
        seen[item.group] = true;
        groups.push(item.group);
      }
    });

    if (selectedGroup && !seen[selectedGroup]) {
      selectedGroup = '';
    }

    groups.forEach(function(groupName) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'group-tab' + (groupName === selectedGroup ? ' active' : '');
      btn.textContent = groupName;
      btn.addEventListener('click', function() {
        selectedGroup = groupName;
        tabsEl.querySelectorAll('.group-tab').forEach(function(t) { t.classList.remove('active'); });
        btn.classList.add('active');
        renderExercises();
      });
      tabsEl.appendChild(btn);
    });
  }

  function renderExercises() {
    var container = document.getElementById('exerciseList');
    // Clear running intervals for replaced cards
    Object.keys(activeTimers).forEach(function(k) {
      clearInterval(activeTimers[k]);
      delete activeTimers[k];
    });
    container.innerHTML = '';

    if (!selectedGroup) {
      container.innerHTML = '<div class="empty-state">Pick a workout group above to start.</div>';
      return;
    }

    var cardIndex = 0;
    planData
      .filter(function(ex) { return ex.group === selectedGroup; })
      .forEach(function(ex) {
        var idx = cardIndex++;
        var div = document.createElement('div');
        div.className = 'card';

        var weightHint = ex.lastWeight ? '<span class="last-weight-hint">' + esc(ex.lastWeight) + ' lbs</span>' : '';
        var lastInfo = ex.lastDate ? 'Last: ' + ex.lastDate : 'No sessions yet';

        var failedBadge = '';
        if (ex.lastFailedSets && ex.lastFailedSets.trim()) {
          var setLabels = ex.lastFailedSets.split(',').map(function(s) { return 'S' + s.trim(); }).join(' ');
          failedBadge = '<span class="badge badge-failed">&#10005; ' + esc(setLabels) + '</span>';
        }

        var altPill = '';
        var altPanel = '';
        if (ex.alternatives && ex.alternatives.trim()) {
          var altItems = '';
          ex.alternatives.split('|').forEach(function(alt) {
            alt = alt.trim();
            if (!alt) return;
            var parts = alt.split('~');
            var altName = parts[0].trim();
            var altDesc = parts[1] ? parts[1].trim() : '';
            var cleanQuery = altName.replace(/\s*\(.*?\)\s*$/, '');
            var altUrl = 'https://www.youtube.com/results?search_query=how+to+' + encodeURIComponent(cleanQuery);
            altItems += '<li><b>' + esc(altName) + '</b>' +
              (altDesc ? '<br><span class="alt-desc">' + esc(altDesc) + '</span>' : '') +
              ' <a href="' + esc(altUrl) + '" target="_blank" rel="noopener noreferrer" class="alt-watch">&#9654; Watch</a></li>';
          });
          if (altItems) {
            altPill = '<button type="button" class="alt-pill">Alt &#x25be;</button>';
            altPanel = '<div class="alt-panel"><ul>' + altItems + '</ul></div>';
          }
        }

        var hasNote = Boolean(ex.lastNote && ex.lastNote.trim() !== '');

        div.innerHTML =
          '<div class="card-header">' +
            '<div class="card-header-left">' +
              '<span class="card-group-label">' + esc(ex.group) + '</span>' +
              '<span class="exercise-title">' + esc(ex.name) + '</span>' +
            '</div>' +
            '<div class="card-header-right">' + weightHint + '<span class="chevron">&#x203A;</span></div>' +
          '</div>' +
          '<div class="card-body">' +
            '<div class="meta-row">' +
              '<span class="badge badge-plan">Plan: ' + esc(ex.setsGoal) + ' &times; ' + esc(ex.repsGoal) + '</span>' +
              '<span class="badge badge-last">' + esc(lastInfo) + '</span>' +
              altPill + failedBadge +
            '</div>' +
            altPanel +
            '<div class="stepper-row">' +
              '<div class="stepper-group">' +
                '<span class="stepper-label">Sets</span>' +
                '<div class="stepper">' +
                  '<button type="button" class="stepper-btn" data-delta="-1">&#8722;</button>' +
                  '<input type="number" inputmode="numeric" class="input-sets stepper-val" value="' + esc(ex.lastSets) + '" min="1">' +
                  '<button type="button" class="stepper-btn" data-delta="1">+</button>' +
                '</div>' +
              '</div>' +
              '<div class="stepper-group">' +
                '<span class="stepper-label">Reps</span>' +
                '<div class="stepper">' +
                  '<button type="button" class="stepper-btn" data-delta="-1">&#8722;</button>' +
                  '<input type="number" inputmode="numeric" class="input-reps stepper-val" value="' + esc(ex.lastReps) + '" min="1">' +
                  '<button type="button" class="stepper-btn" data-delta="1">+</button>' +
                '</div>' +
              '</div>' +
              '<div class="stepper-group">' +
                '<span class="stepper-label">Lbs</span>' +
                '<div class="stepper">' +
                  '<button type="button" class="stepper-btn" data-delta="-5">&#8722;</button>' +
                  '<input type="number" inputmode="decimal" class="input-weight stepper-val" value="' + esc(ex.lastWeight) + '" min="0" step="5">' +
                  '<button type="button" class="stepper-btn" data-delta="5">+</button>' +
                '</div>' +
              '</div>' +
            '</div>' +
            '<div class="failure-row">' +
              '<span class="failure-label">Failed</span>' +
              '<div class="pill-group">' +
                '<button type="button" class="fail-pill">S1</button>' +
                '<button type="button" class="fail-pill">S2</button>' +
                '<button type="button" class="fail-pill">S3</button>' +
              '</div>' +
            '</div>' +
            '<div class="note-toggle">' + (hasNote ? 'Note' : '+ Add note') + '</div>' +
            '<div class="note-section' + (hasNote ? ' visible' : '') + '">' +
              '<div class="note-row">' +
                '<textarea class="note-input" rows="1" placeholder="Add a note...">' + esc(ex.lastNote || '') + '</textarea>' +
                '<button type="button" class="note-clear">Clear</button>' +
              '</div>' +
            '</div>' +
            '<button type="button" class="btn-submit log-ex-btn">Log Session</button>' +
            '<div class="timer-wrap">' +
              '<div class="timer-btns" id="timerBtns_' + idx + '">' +
                '<button type="button" class="timer-btn" data-duration="60">60s</button>' +
                '<button type="button" class="timer-btn" data-duration="90">90s</button>' +
              '</div>' +
              '<div class="timer-bar-wrap" id="timerBar_' + idx + '" title="Tap to cancel timer">' +
                '<div class="timer-bar-fill" id="timerFill_' + idx + '"></div>' +
                '<span class="timer-bar-text" id="timerText_' + idx + '"></span>' +
              '</div>' +
            '</div>' +
          '</div>';

        wireExerciseCard(div, ex.name, idx, hasNote);
        container.appendChild(div);

        if (hasNote) {
          var ta = div.querySelector('.note-input');
          if (ta) autoResize(ta);
        }
      });
  }

  function wireExerciseCard(card, exerciseName, idx) {
    var header = card.querySelector('.card-header');
    header.addEventListener('click', function() {
      var wasExpanded = card.classList.contains('expanded');
      document.querySelectorAll('#exerciseList .card').forEach(function(c) { c.classList.remove('expanded'); });
      if (!wasExpanded) {
        card.classList.add('expanded');
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });

    var altPill = card.querySelector('.alt-pill');
    var altPanel = card.querySelector('.alt-panel');
    if (altPill && altPanel) {
      altPill.addEventListener('click', function() {
        var isOpen = altPanel.classList.contains('open');
        altPanel.classList.toggle('open', !isOpen);
        altPill.classList.toggle('open', !isOpen);
        altPill.innerHTML = isOpen ? 'Alt &#x25be;' : 'Alt &#x25b4;';
      });
    }

    card.querySelectorAll('.stepper-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var delta = parseFloat(btn.dataset.delta);
        var input = btn.parentElement.querySelector('input');
        var val = (parseFloat(input.value) || 0) + delta;
        var min = input.min !== '' ? parseFloat(input.min) : -Infinity;
        if (val >= min) input.value = val;
      });
    });

    card.querySelectorAll('.fail-pill').forEach(function(pill) {
      pill.addEventListener('click', function() {
        pill.classList.toggle('active');
      });
    });

    var noteToggle = card.querySelector('.note-toggle');
    var noteSection = card.querySelector('.note-section');
    var noteInput = card.querySelector('.note-input');
    var noteClear = card.querySelector('.note-clear');

    noteToggle.addEventListener('click', function() {
      var isVisible = noteSection.classList.contains('visible');
      noteSection.classList.toggle('visible', !isVisible);
      noteToggle.textContent = isVisible
        ? '+ Add note'
        : (noteInput.value.trim() ? 'Note' : '+ Add note');
    });

    noteInput.addEventListener('input', function() { autoResize(noteInput); });

    noteClear.addEventListener('click', function() {
      noteInput.value = '';
      autoResize(noteInput);
      noteToggle.textContent = '+ Add note';
    });

    var submitBtn = card.querySelector('.log-ex-btn');
    submitBtn.addEventListener('click', function() {
      submitExerciseLog(card, exerciseName, submitBtn);
    });

    card.querySelectorAll('.timer-btn').forEach(function(tBtn) {
      tBtn.addEventListener('click', function() {
        startTimer(idx, Number(tBtn.dataset.duration));
      });
    });

    var barWrap = card.querySelector('.timer-bar-wrap');
    barWrap.addEventListener('click', function() {
      startTimer(idx, 0); // cancel running timer
    });
  }

  async function submitExerciseLog(card, exerciseName, btn) {
    var failedNums = [];
    card.querySelectorAll('.fail-pill.active').forEach(function(p) {
      failedNums.push(p.textContent.replace('S', ''));
    });

    var payload = {
      name: exerciseName,
      sets: Number(card.querySelector('.input-sets').value) || 0,
      reps: Number(card.querySelector('.input-reps').value) || 0,
      weight: Number(card.querySelector('.input-weight').value) || 0,
      failedSets: failedNums.join(','),
      note: card.querySelector('.note-input').value.trim()
    };

    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
      var res = await apiCall('logWorkout', { data: payload });
      btn.disabled = false;
      btn.classList.add('success');
      btn.textContent = '✓ Logged';
      card.querySelectorAll('.fail-pill').forEach(function(p) { p.classList.remove('active'); });

      var hint = card.querySelector('.last-weight-hint');
      if (hint) hint.textContent = payload.weight + ' lbs';

      setTimeout(function() {
        btn.classList.remove('success');
        btn.textContent = 'Log Session';
      }, 2000);

      if (res.plan) planData = res.plan;
      if (res.todayWorkout) {
        sessionLog = res.todayWorkout;
      } else {
        var entry = { name: payload.name, sets: payload.sets, reps: payload.reps, weight: payload.weight };
        var idx = sessionLog.findIndex(function(s) { return s.name === payload.name; });
        if (idx >= 0) sessionLog[idx] = entry;
        else sessionLog.push(entry);
      }

      historyLoaded = false;
      renderSessionSummary();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Log Session';
      if (err.code !== 'UNAUTHORIZED') {
        alert('Could not save workout: ' + (err.message || err));
      }
    }
  }

  /* ===== Cardio Logger ===== */
  async function submitCardio() {
    var type = document.getElementById('cardioType').value;
    var activePill = document.querySelector('#cardioIntensityPills .intensity-pill.active');
    var intensity = activePill ? activePill.textContent : '';
    var minutes = Number(document.getElementById('cardioMins').value);

    if (!type) { alert('Please select an activity.'); return; }
    if (!minutes || minutes <= 0) { alert('Please enter minutes.'); return; }

    var note = document.getElementById('cardioNoteInput').value.trim();
    var payload = { type: type, intensity: intensity, minutes: minutes, note: note };
    var btn = document.getElementById('cardioSubmitBtn');

    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
      var res = await apiCall('logCardio', { data: payload });
      btn.disabled = false;
      btn.classList.add('success');
      btn.textContent = '✓ Logged';
      setTimeout(function() {
        btn.classList.remove('success');
        btn.textContent = 'Log Cardio';
      }, 2000);

      if (res.todayCardio) {
        cardioLog = res.todayCardio;
      } else {
        var idx = cardioLog.findIndex(function(c) { return c.type === payload.type; });
        if (idx >= 0) cardioLog[idx] = payload;
        else cardioLog.push(payload);
      }

      historyLoaded = false;
      renderCardioToday();
      renderSessionSummary();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Log Cardio';
      if (err.code !== 'UNAUTHORIZED') {
        alert('Could not save cardio: ' + (err.message || err));
      }
    }
  }

  function renderCardioToday() {
    var el = document.getElementById('cardioToday');
    if (!cardioLog.length) { el.innerHTML = ''; return; }
    el.innerHTML = cardioLog.map(function(c) {
      return '<div class="cardio-entry-today">' + esc(c.type) +
        ' &mdash; <span>' + esc(c.minutes) + ' min' +
        (c.intensity ? ' @ ' + esc(c.intensity) : '') + '</span></div>';
    }).join('');
  }

  function renderSessionSummary() {
    var container = document.getElementById('sessionSummary');
    if (sessionLog.length === 0 && cardioLog.length === 0) {
      container.innerHTML = '';
      return;
    }

    var vol = 0;
    var exHtml = '';
    var cardioHtml = '';

    sessionLog.forEach(function(e) {
      vol += Number(e.sets) * Number(e.reps) * Number(e.weight);
      exHtml += '<div class="summary-entry">' + esc(e.name) +
        ' &mdash; <span>' + esc(e.sets) + '&times;' + esc(e.reps) + ' @ ' + esc(e.weight) + ' lbs</span></div>';
    });

    cardioLog.forEach(function(c) {
      cardioHtml += '<div class="summary-cardio-entry">' + esc(c.type) +
        ' &mdash; <span>' + esc(c.minutes) + ' min' +
        (c.intensity ? ' @ ' + esc(c.intensity) : '') + '</span></div>';
    });

    var volBlock = vol > 0
      ? '<div class="summary-volume-block"><div class="summary-volume-number">' + vol.toLocaleString() +
        '</div><div class="summary-volume-label">Total Volume (lbs)</div></div>'
      : '';

    var cardioSection = cardioHtml
      ? (exHtml ? '<div class="summary-section-label">Cardio</div>' : '') + cardioHtml
      : '';

    container.innerHTML =
      '<div class="session-summary"><div class="summary-header">Today\'s Session</div>' +
      volBlock + exHtml + cardioSection + '</div>';
  }

  /* ===== Rest Timer & Audio ===== */
  function startTimer(idx, duration) {
    if (activeTimers[idx]) {
      clearInterval(activeTimers[idx]);
      delete activeTimers[idx];
      resetTimer(idx);
      return;
    }
    if (!duration) return;

    var btns = document.getElementById('timerBtns_' + idx);
    var barWrap = document.getElementById('timerBar_' + idx);
    var fill = document.getElementById('timerFill_' + idx);
    var text = document.getElementById('timerText_' + idx);
    if (!btns || !barWrap || !fill || !text) return;

    btns.style.display = 'none';
    barWrap.style.display = 'block';
    var primaryColor = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
    fill.style.transition = 'none';
    fill.style.background = primaryColor;
    fill.style.width = '100%';
    text.style.color = '#000';
    text.textContent = String(duration);
    void fill.offsetWidth;
    fill.style.transition = 'width 1s linear';

    var remaining = duration;
    var total = duration;
    activeTimers[idx] = setInterval(function() {
      remaining--;
      if (remaining <= 0) {
        clearInterval(activeTimers[idx]);
        delete activeTimers[idx];
        fill.style.transition = 'none';
        fill.style.width = '100%';
        fill.style.background = '#e53935';
        barWrap.style.background = '#e53935';
        text.textContent = 'Done!';
        text.style.color = '#fff';
        playBeep();
        setTimeout(function() {
          barWrap.style.background = '';
          resetTimer(idx);
        }, 5000);
      } else {
        fill.style.width = (remaining / total * 100) + '%';
        if (remaining <= 15) fill.style.background = '#e53935';
        text.textContent = String(remaining);
      }
    }, 1000);
  }

  function resetTimer(idx) {
    var btns = document.getElementById('timerBtns_' + idx);
    var barWrap = document.getElementById('timerBar_' + idx);
    var fill = document.getElementById('timerFill_' + idx);
    if (!btns || !barWrap || !fill) return;
    btns.style.display = '';
    barWrap.style.display = 'none';
    fill.style.transition = 'none';
    fill.style.background = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
    fill.style.width = '100%';
  }

  function playBeep() {
    try {
      var AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      var ctx = new AudioCtx();
      [[0, 0.3], [0.4, 0.7]].forEach(function(p) {
        var o = ctx.createOscillator();
        var g = ctx.createGain();
        o.connect(g);
        g.connect(ctx.destination);
        o.type = 'sine';
        o.frequency.value = 880;
        g.gain.value = 0.3;
        o.start(ctx.currentTime + p[0]);
        o.stop(ctx.currentTime + p[1]);
      });
    } catch (e) {}
  }

  function autoResize(ta) {
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  }

  /* ===== Progress / History Views ===== */
  function getCutoffDateStr() {
    var cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - currentDays);
    return cutoff.toISOString().split('T')[0];
  }

  function getFilteredHistory() {
    var cutoffStr = getCutoffDateStr();
    return allHistory.filter(function(e) { return e.date >= cutoffStr; });
  }

  function getFilteredCardioHistory() {
    var cutoffStr = getCutoffDateStr();
    return allCardioHistory.filter(function(e) { return e.date >= cutoffStr; });
  }

  function renderActiveHistoryView() {
    if (!historyLoaded) return;
    if (currentHistoryView === 'log') renderSessionLog();
    else if (currentHistoryView === 'exercise') renderByExercise();
    else if (currentHistoryView === 'charts') renderChart();
  }

  function failBadgeHtml(failedSets) {
    if (!failedSets || !failedSets.trim()) return '';
    var pills = failedSets.split(',').map(function(s) { return 'S' + s.trim(); }).join(' ');
    return '<span class="hist-fail-badge">&#10005; ' + esc(pills) + '</span>';
  }

  function noteIconHtml(note) {
    if (!note || !note.trim()) return '';
    return '<span class="note-icon" role="button" tabindex="0" aria-label="Toggle note">i</span>';
  }

  function noteContentHtml(note) {
    if (!note || !note.trim()) return '';
    return '<div class="entry-note">' + esc(note) + '</div>';
  }

  function renderSessionLog() {
    var container = document.getElementById('historyContent');
    var filtered = getFilteredHistory();
    var filteredCardio = getFilteredCardioHistory();

    if (!filtered.length && !filteredCardio.length) {
      container.innerHTML = '<div class="empty-state">No workouts logged for this period.</div>';
      return;
    }

    var byDate = {};
    filtered.forEach(function(e) {
      if (!byDate[e.date]) byDate[e.date] = { exercises: [], cardio: [] };
      byDate[e.date].exercises.push(e);
    });
    filteredCardio.forEach(function(e) {
      if (!byDate[e.date]) byDate[e.date] = { exercises: [], cardio: [] };
      byDate[e.date].cardio.push(e);
    });

    var dates = Object.keys(byDate).sort().reverse();
    var html = '';

    dates.forEach(function(date) {
      var formatted = new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
        weekday: 'long', month: 'short', day: 'numeric'
      });
      html += '<div class="session-card"><div class="session-date">' + esc(formatted) + '</div>';

      byDate[date].exercises.forEach(function(e) {
        html += '<div class="session-exercise">' +
          '<div class="ex-row-main">' +
            '<span class="ex-name">' + esc(e.exercise) + '</span>' +
            '&nbsp;&mdash; <span class="ex-stats">' + esc(e.sets) + '&times;' + esc(e.reps) + ' @ ' + esc(e.weight) + ' lbs</span>' +
            failBadgeHtml(e.failedSets) + noteIconHtml(e.note) +
          '</div>' +
          noteContentHtml(e.note) +
        '</div>';
      });

      byDate[date].cardio.forEach(function(e) {
        html += '<div class="session-cardio">' +
          '<div class="ex-row-main">' +
            '<span class="cardio-tag">Cardio</span>&nbsp;' +
            '<span class="ex-name">' + esc(e.type) + '</span>' +
            '&nbsp;&mdash; <span class="ex-stats">' + esc(e.minutes) + ' min' +
            (e.intensity ? ' &bull; ' + esc(e.intensity) : '') + '</span>' +
            noteIconHtml(e.note) +
          '</div>' +
          noteContentHtml(e.note) +
        '</div>';
      });

      html += '</div>';
    });

    container.innerHTML = html;
  }

  function renderByExercise() {
    var container = document.getElementById('exerciseContent');
    var filtered = getFilteredHistory();
    var filteredCardio = getFilteredCardioHistory();

    var byEx = {};
    filtered.forEach(function(e) {
      if (!byEx[e.exercise]) byEx[e.exercise] = [];
      byEx[e.exercise].push(e);
    });

    var exGroupMap = {};
    planData.forEach(function(ex) { exGroupMap[ex.name] = ex.group; });

    var grouped = {};
    planData.forEach(function(ex) {
      if (!byEx[ex.name]) return;
      if (!grouped[ex.group]) grouped[ex.group] = [];
      if (grouped[ex.group].indexOf(ex.name) === -1) grouped[ex.group].push(ex.name);
    });

    Object.keys(byEx).forEach(function(name) {
      if (!exGroupMap[name]) {
        if (!grouped.Other) grouped.Other = [];
        if (grouped.Other.indexOf(name) === -1) grouped.Other.push(name);
      }
    });

    var html = '';
    Object.keys(grouped).sort().forEach(function(group) {
      var exercises = grouped[group].slice().sort();
      if (!exercises.length) return;

      html += '<div class="ex-group-label">' + esc(group) + '</div>';
      exercises.forEach(function(exName) {
        var entries = (byEx[exName] || []).slice().sort(function(a, b) { return b.date.localeCompare(a.date); });
        if (!entries.length) return;

        var count = entries.length;
        var bodyHtml = entries.map(function(e) {
          var fmt = new Date(e.date + 'T12:00:00').toLocaleDateString('en-US', {
            weekday: 'short', month: 'short', day: 'numeric'
          });
          return '<div class="ex-entry">' +
            '<div class="ex-entry-main">' +
              '<span class="ex-entry-date">' + esc(fmt) + '</span>' +
              '<span class="ex-entry-stats">' + esc(e.sets) + '&times;' + esc(e.reps) + ' @ ' + esc(e.weight) + ' lbs</span>' +
              failBadgeHtml(e.failedSets) + noteIconHtml(e.note) +
            '</div>' +
            noteContentHtml(e.note) +
          '</div>';
        }).join('');

        html += '<div class="ex-card">' +
          '<div class="ex-card-header">' +
            '<span class="ex-card-name">' + esc(exName) + '</span>' +
            '<span class="ex-card-meta">' + count + ' session' + (count > 1 ? 's' : '') + '</span>' +
            '<span class="ex-chevron">&#x203A;</span>' +
          '</div>' +
          '<div class="ex-card-body">' + bodyHtml + '</div>' +
        '</div>';
      });
    });

    if (filteredCardio.length) {
      var byType = {};
      filteredCardio.forEach(function(e) {
        if (!byType[e.type]) byType[e.type] = [];
        byType[e.type].push(e);
      });

      html += '<div class="ex-group-label">Cardio</div>';
      Object.keys(byType).sort().forEach(function(type) {
        var entries = byType[type].slice().sort(function(a, b) { return b.date.localeCompare(a.date); });
        var count = entries.length;
        var bodyHtml = entries.map(function(e) {
          var fmt = new Date(e.date + 'T12:00:00').toLocaleDateString('en-US', {
            weekday: 'short', month: 'short', day: 'numeric'
          });
          return '<div class="ex-entry">' +
            '<div class="ex-entry-main">' +
              '<span class="ex-entry-date">' + esc(fmt) + '</span>' +
              '<span class="ex-entry-stats">' + esc(e.minutes) + ' min' +
              (e.intensity ? ' &bull; ' + esc(e.intensity) : '') + '</span>' +
              noteIconHtml(e.note) +
            '</div>' +
            noteContentHtml(e.note) +
          '</div>';
        }).join('');

        html += '<div class="ex-card cardio-ex-card">' +
          '<div class="ex-card-header">' +
            '<span class="ex-card-name">' + esc(type) + '</span>' +
            '<span class="ex-card-meta">' + count + ' session' + (count > 1 ? 's' : '') + '</span>' +
            '<span class="ex-chevron">&#x203A;</span>' +
          '</div>' +
          '<div class="ex-card-body">' + bodyHtml + '</div>' +
        '</div>';
      });
    }

    container.innerHTML = html || '<div class="empty-state">No workouts logged for this period.</div>';
  }

  function populateChartGroupSelect() {
    var select = document.getElementById('chartGroupSelect');
    var previous = select.value;
    select.innerHTML = '<option value="">Select a group&hellip;</option>';

    var seen = {};
    planData.forEach(function(ex) {
      if (!seen[ex.group]) {
        seen[ex.group] = true;
        var opt = document.createElement('option');
        opt.value = ex.group;
        opt.textContent = ex.group;
        select.appendChild(opt);
      }
    });

    var cardioOpt = document.createElement('option');
    cardioOpt.value = '__cardio__';
    cardioOpt.textContent = 'Cardio (minutes)';
    select.appendChild(cardioOpt);

    if (previous) select.value = previous;
  }

  function renderChart() {
    var group = document.getElementById('chartGroupSelect').value;
    var canvasBox = document.getElementById('chartCanvasBox');
    var canvas = document.getElementById('progressChart');
    var emptyMsg = document.getElementById('chartEmpty');

    if (!window.Chart) {
      canvasBox.hidden = true;
      emptyMsg.hidden = false;
      emptyMsg.textContent = 'Chart library unavailable offline.';
      return;
    }

    if (!group) {
      canvasBox.hidden = true;
      emptyMsg.hidden = false;
      emptyMsg.textContent = 'Select a muscle group to see progress.';
      if (progressChart) { progressChart.destroy(); progressChart = null; }
      return;
    }

    var filtered = getFilteredHistory();
    var filteredCardio = getFilteredCardioHistory();
    var datasets = [];
    var sortedDates;
    var formattedLabels;

    if (group === '__cardio__') {
      if (!filteredCardio.length) {
        canvasBox.hidden = true;
        emptyMsg.hidden = false;
        emptyMsg.textContent = 'No cardio data for this period.';
        if (progressChart) { progressChart.destroy(); progressChart = null; }
        return;
      }

      var byType = {};
      var allDates = {};
      filteredCardio.forEach(function(e) {
        if (!byType[e.type]) byType[e.type] = {};
        byType[e.type][e.date] = (byType[e.type][e.date] || 0) + Number(e.minutes);
        allDates[e.date] = true;
      });

      sortedDates = Object.keys(allDates).sort();
      formattedLabels = sortedDates.map(function(d) {
        return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      });

      Object.keys(byType).forEach(function(type, k) {
        var color = chartColors[k % chartColors.length];
        datasets.push({
          label: type,
          data: sortedDates.map(function(d) { return byType[type][d] !== undefined ? byType[type][d] : null; }),
          borderColor: color,
          backgroundColor: color,
          tension: 0.3,
          spanGaps: true,
          pointRadius: 4,
          pointHoverRadius: 6,
          borderWidth: 2,
          fill: false
        });
      });
    } else {
      var exercisesInGroup = planData
        .filter(function(ex) { return ex.group === group; })
        .map(function(ex) { return ex.name; });

      var relevant = filtered.filter(function(e) {
        return exercisesInGroup.indexOf(e.exercise) !== -1;
      });

      if (!relevant.length) {
        canvasBox.hidden = true;
        emptyMsg.hidden = false;
        emptyMsg.textContent = 'No data for this group in the selected time range.';
        if (progressChart) { progressChart.destroy(); progressChart = null; }
        return;
      }

      var byExercise = {};
      var allDatesEx = {};
      relevant.forEach(function(e) {
        if (!byExercise[e.exercise]) byExercise[e.exercise] = {};
        byExercise[e.exercise][e.date] = Number(e.weight);
        allDatesEx[e.date] = true;
      });

      sortedDates = Object.keys(allDatesEx).sort();
      formattedLabels = sortedDates.map(function(d) {
        return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      });

      Object.keys(byExercise).forEach(function(exName, k) {
        var color = chartColors[k % chartColors.length];
        datasets.push({
          label: exName,
          data: sortedDates.map(function(d) { return byExercise[exName][d] !== undefined ? byExercise[exName][d] : null; }),
          borderColor: color,
          backgroundColor: color,
          tension: 0.3,
          spanGaps: true,
          pointRadius: 4,
          pointHoverRadius: 6,
          borderWidth: 2,
          fill: false
        });
      });
    }

    canvasBox.hidden = false;
    emptyMsg.hidden = true;
    if (progressChart) progressChart.destroy();

    var yLabel = group === '__cardio__' ? 'Minutes' : 'Weight (lbs)';
    progressChart = new window.Chart(canvas, {
      type: 'line',
      data: { labels: formattedLabels, datasets: datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { boxWidth: 12, padding: 15, font: { size: 12 } }
          },
          tooltip: { mode: 'index', intersect: false }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 11 }, maxRotation: 45 }
          },
          y: {
            title: { display: true, text: yLabel, font: { size: 12 } },
            grid: { color: 'rgba(0,0,0,0.06)' },
            ticks: { font: { size: 11 } }
          }
        },
        interaction: { mode: 'nearest', axis: 'x', intersect: false }
      }
    });
  }

  /* ===== PWA Install Handling (Web Install API + beforeinstallprompt fallback) ===== */
  function setupInstallPrompt() {
    var installButton = document.getElementById('installAppBtn');
    var installStatus = document.getElementById('installStatus');
    var isStandalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
    if (isStandalone) return;

    var supportsWebInstall = typeof Navigator.prototype.install === 'function';
    var deferredInstallPrompt;

    if (supportsWebInstall) {
      installButton.hidden = false;
      syncMenuDivider();
    }

    window.addEventListener('beforeinstallprompt', function(event) {
      event.preventDefault();
      deferredInstallPrompt = event;
      if (!supportsWebInstall) {
        installButton.hidden = false;
        syncMenuDivider();
      }
    });

    installButton.addEventListener('click', async function() {
      if (installButton.getAttribute('aria-disabled') === 'true') return;
      installButton.setAttribute('aria-disabled', 'true');

      try {
        if (supportsWebInstall) {
          await navigator.install();
          installStatus.textContent = 'The app was installed or opened.';
          installButton.hidden = true;
          syncMenuDivider();
        } else if (deferredInstallPrompt) {
          var promptEvent = deferredInstallPrompt;
          deferredInstallPrompt = undefined;
          await promptEvent.prompt();
          var choice = await promptEvent.userChoice;
          installStatus.textContent = choice.outcome === 'accepted'
            ? 'The app was installed.'
            : 'Installation canceled.';
          if (!deferredInstallPrompt) {
            installButton.hidden = true;
            syncMenuDivider();
          }
        }
      } catch (error) {
        if (error && error.name === 'AbortError') {
          installStatus.textContent = 'Installation was canceled or could not complete.';
        } else {
          installStatus.textContent = 'Installation could not start.';
          console.error(error);
        }
      } finally {
        installButton.removeAttribute('aria-disabled');
        closeDropdown();
      }
    });
  }

  /* ===== Event Wiring & Initialization ===== */
  function init() {
    applyTheme(getCachedTheme());

    // Register Service Worker
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('/sw.js').catch(function() {});
    }

    setupInstallPrompt();

    // Settings menu
    document.getElementById('settingsBtn').addEventListener('click', function() {
      document.getElementById('themeDropdown').classList.toggle('open');
    });
    document.addEventListener('click', function(e) {
      var wrap = document.querySelector('.theme-picker-wrap');
      if (wrap && !wrap.contains(e.target)) closeDropdown();
    });

    // Sign out
    document.getElementById('signOutBtn').addEventListener('click', async function() {
      closeDropdown();
      var tok = getToken();
      showAuthGate();
      if (tok) {
        try {
          await fetch(window.WORKOUT_CONFIG.GAS_API_URL, {
            method: 'POST',
            redirect: 'follow',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: 'logout', token: tok })
          });
        } catch (e) {}
      }
    });

    // Show/hide password toggle
    var pwInput = document.getElementById('loginPassword');
    var togglePwBtn = document.getElementById('togglePwBtn');
    togglePwBtn.addEventListener('click', function() {
      var showing = pwInput.type === 'text';
      pwInput.type = showing ? 'password' : 'text';
      togglePwBtn.textContent = showing ? 'Show' : 'Hide';
      togglePwBtn.setAttribute('aria-pressed', showing ? 'false' : 'true');
    });

    // Sign-in submission
    document.getElementById('loginForm').addEventListener('submit', async function(e) {
      e.preventDefault();
      var username = document.getElementById('loginUsername').value.trim();
      var password = pwInput.value;
      var submitBtn = document.getElementById('loginSubmitBtn');
      var errEl = document.getElementById('loginError');

      errEl.hidden = true;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Signing in...';

      try {
        var res = await apiCall('login', { username: username, password: password });
        setToken(res.token);
        pwInput.value = '';
        if (res.theme && themes[res.theme]) applyTheme(res.theme);
        await loadBootstrap();
      } catch (err) {
        errEl.textContent = err.message || 'Sign in failed.';
        errEl.hidden = false;
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign In';
      }
    });

    // Top page nav toggle
    document.getElementById('pageToggleBtn').addEventListener('click', function() {
      switchPage(currentPage === 'history' ? 'workout' : 'history', true);
    });
    window.addEventListener('popstate', function() {
      var params = new URLSearchParams(window.location.search);
      switchPage(params.get('page') === 'history' ? 'history' : 'workout', false);
    });

    // Cardio controls
    document.querySelectorAll('#cardioIntensityPills .intensity-pill').forEach(function(pill) {
      pill.addEventListener('click', function() {
        document.querySelectorAll('#cardioIntensityPills .intensity-pill').forEach(function(p) {
          p.classList.remove('active');
        });
        pill.classList.add('active');
      });
    });

    var cardioNoteToggle = document.getElementById('cardioNoteToggle');
    var cardioNoteSection = document.getElementById('cardioNoteSection');
    var cardioNoteInput = document.getElementById('cardioNoteInput');
    cardioNoteToggle.addEventListener('click', function() {
      var vis = cardioNoteSection.classList.contains('visible');
      cardioNoteSection.classList.toggle('visible', !vis);
      cardioNoteToggle.textContent = vis ? '+ Add note' : (cardioNoteInput.value.trim() ? 'Note' : '+ Add note');
    });
    cardioNoteInput.addEventListener('input', function() { autoResize(cardioNoteInput); });
    document.getElementById('cardioNoteClear').addEventListener('click', function() {
      cardioNoteInput.value = '';
      autoResize(cardioNoteInput);
      cardioNoteToggle.textContent = '+ Add note';
    });
    document.getElementById('cardioSubmitBtn').addEventListener('click', submitCardio);

    // History view tabs & delegation
    document.querySelectorAll('#historyViewToggle .view-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        currentHistoryView = btn.dataset.view;
        document.querySelectorAll('#historyViewToggle .view-btn').forEach(function(b) {
          b.classList.remove('active');
        });
        btn.classList.add('active');
        document.getElementById('logView').hidden = currentHistoryView !== 'log';
        document.getElementById('exerciseView').hidden = currentHistoryView !== 'exercise';
        document.getElementById('chartsView').hidden = currentHistoryView !== 'charts';
        renderActiveHistoryView();
      });
    });

    document.getElementById('timeFilter').addEventListener('change', function(e) {
      currentDays = parseInt(e.target.value, 10) || 30;
      renderActiveHistoryView();
    });

    document.getElementById('collapseAllBtn').addEventListener('click', function() {
      document.querySelectorAll('#exerciseContent .ex-card.expanded').forEach(function(card) {
        card.classList.remove('expanded');
      });
    });

    document.getElementById('chartGroupSelect').addEventListener('change', renderChart);

    // Event delegation for history note toggles & By Exercise card expansion
    document.getElementById('historyPage').addEventListener('click', function(e) {
      var noteIcon = e.target.closest('.note-icon');
      if (noteIcon) {
        e.stopPropagation();
        var rowParent = noteIcon.parentElement && noteIcon.parentElement.parentElement;
        var noteDiv = rowParent && rowParent.querySelector('.entry-note');
        if (noteDiv) {
          noteDiv.classList.toggle('open');
          noteIcon.classList.toggle('open');
        }
        return;
      }

      var cardHeader = e.target.closest('.ex-card-header');
      if (cardHeader) {
        var exCard = cardHeader.closest('.ex-card');
        if (exCard) exCard.classList.toggle('expanded');
      }
    });

    // Initial route & auth check
    var initialParams = new URLSearchParams(window.location.search);
    if (initialParams.get('page') === 'history') {
      currentPage = 'history';
    }

    if (getToken()) {
      loadBootstrap();
    } else {
      showAuthGate();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
