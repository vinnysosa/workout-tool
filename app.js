(function() {
  'use strict';

  var STORAGE_TOKEN_KEY = 'wb_session_token';
  var STORAGE_SCHEME_KEY = 'wb-color-scheme';
  var RING_CIRCUMFERENCE = 2 * Math.PI * 114; // r=114 -> ~716.28

  /* ===== Application State ===== */
  var currentPage = 'workout'; // 'workout' | 'history'
  var exercises = [];          // flat rows from Exercises_v2
  var todayWorkout = [];
  var todayCardio = [];
  var lastCardio = {};
  var selectedGroup = '';
  var expandedSlotId = '';
  var activeCardioMachine = 'Arm Crank';

  // Progress page state
  var historyLoaded = false;
  var historyWindowDays = 90;
  var progView = 'muscles'; // 'muscles' | 'sessions' | 'cardio'
  var progSplit = 'ALL';
  var baselines = {};
  var allHistory = [];
  var allCardioHistory = [];
  var openMovementByMuscle = {}; // muscle -> exercise name

  // Rest timer state
  var timerTickId = null;
  var timerEndMs = 0;
  var timerTotalMs = 60000;
  var timerFinished = false;
  var wakeLockSentinel = null;

  /* ===== Safe HTML Escape ===== */
  function esc(val) {
    return String(val == null ? '' : val)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ===== Token & Theme Helpers ===== */
  function getToken() {
    try { return localStorage.getItem(STORAGE_TOKEN_KEY) || ''; }
    catch (e) { return ''; }
  }

  function setToken(tok) {
    try {
      if (tok) localStorage.setItem(STORAGE_TOKEN_KEY, tok);
      else localStorage.removeItem(STORAGE_TOKEN_KEY);
    } catch (e) {}
  }

  function getSystemScheme() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function getRenderedScheme() {
    var stored = '';
    try { stored = localStorage.getItem(STORAGE_SCHEME_KEY) || ''; } catch (e) {}
    if (stored === 'dark' || stored === 'light') return stored;
    return getSystemScheme();
  }

  function syncThemeMetaColor() {
    var metaTheme = document.getElementById('metaThemeColor');
    if (!metaTheme) return;
    metaTheme.content = getRenderedScheme() === 'dark' ? '#09111f' : '#0b57d0';
  }

  function applySchemeOverride(storedValue) {
    var metaScheme = document.querySelector('meta[name="color-scheme"]');
    if (metaScheme) {
      metaScheme.content = (storedValue === 'dark' || storedValue === 'light') ? storedValue : 'light dark';
    }
    syncThemeMetaColor();
  }

  function toggleColorScheme() {
    var currentRendered = getRenderedScheme();
    var target = currentRendered === 'dark' ? 'light' : 'dark';
    var sys = getSystemScheme();

    try {
      if (target === sys) {
        localStorage.removeItem(STORAGE_SCHEME_KEY);
        applySchemeOverride('');
      } else {
        localStorage.setItem(STORAGE_SCHEME_KEY, target);
        applySchemeOverride(target);
      }
    } catch (e) {
      applySchemeOverride(target);
    }
  }

  /* ===== API Client ===== */
  async function apiCall(action, extra) {
    var cfg = window.WORKOUT_CONFIG || {};
    if (!cfg.GAS_API_URL) throw new Error('Missing GAS_API_URL in config.js');

    var body = Object.assign({ action: action }, extra || {});
    if (action !== 'login') body.token = getToken();

    var res = await fetch(cfg.GAS_API_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    });

    if (!res.ok) throw new Error('Network error (' + res.status + ')');

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

  /* ===== Shell & Navigation ===== */
  function showAuthGate(errorMsg) {
    setToken('');
    document.getElementById('appShell').hidden = true;
    document.getElementById('topNav').hidden = true;
    document.getElementById('signOutBtn').hidden = true;
    document.getElementById('authGate').hidden = false;

    var errEl = document.getElementById('loginError');
    if (errorMsg) {
      errEl.textContent = errorMsg;
      errEl.hidden = false;
    } else {
      errEl.textContent = '';
      errEl.hidden = true;
    }
  }

  function showAppShell() {
    document.getElementById('authGate').hidden = true;
    document.getElementById('appShell').hidden = false;
    document.getElementById('topNav').hidden = false;
    document.getElementById('signOutBtn').hidden = false;
    syncPageDisplay();
  }

  function switchPage(page, pushState) {
    currentPage = page === 'history' ? 'history' : 'workout';
    syncPageDisplay();

    if (pushState !== false) {
      var url = currentPage === 'history' ? '?page=history' : window.location.pathname;
      try { window.history.pushState({ page: currentPage }, '', url); } catch (e) {}
    }

    if (currentPage === 'history') {
      if (!historyLoaded) loadHistory();
      else renderProgress();
    }
  }

  function syncPageDisplay() {
    var isHist = currentPage === 'history';
    document.getElementById('workoutPage').hidden = isHist;
    document.getElementById('historyPage').hidden = !isHist;
    document.querySelectorAll('#topNav .mode-tab').forEach(function(btn) {
      btn.classList.toggle('active', btn.dataset.page === currentPage);
    });
  }

  /* ===== Data Bootstrap ===== */
  async function loadBootstrap() {
    showAppShell();
    var slotList = document.getElementById('slotList');
    if (!exercises.length) {
      slotList.innerHTML = '<div class="state-msg">Loading workout&hellip;</div>';
    }

    try {
      var data = await apiCall('v2_bootstrap');
      exercises = data.exercises || [];
      todayWorkout = data.todayWorkout || [];
      todayCardio = data.todayCardio || [];
      lastCardio = data.lastCardio || {};

      if (!selectedGroup) {
        selectedGroup = data.suggestedGroup || (exercises[0] && exercises[0].group) || 'Back & Biceps';
      }

      renderSplitTabs();
      renderSlotList();
      prefillCardioInputs();
      renderCardioHeaderStatus();
      renderTodaySummary();

      if (currentPage === 'history') loadHistory();
    } catch (err) {
      if (err.code !== 'UNAUTHORIZED') {
        slotList.innerHTML = '<div class="state-msg">' + esc(err.message || 'Could not load workout.') + '</div>';
      }
    }
  }

  async function loadHistory() {
    var container = document.getElementById('progContent');
    container.innerHTML = '<div class="state-msg">Loading progress&hellip;</div>';

    try {
      var res = await apiCall('v2_history', { days: 365 });
      if (res.exercises && res.exercises.length) exercises = res.exercises;
      baselines = res.baselines || {};
      allHistory = res.history || [];
      allCardioHistory = res.cardioHistory || [];
      historyLoaded = true;
      renderProgress();
    } catch (err) {
      if (err.code !== 'UNAUTHORIZED') {
        container.innerHTML = '<div class="state-msg">' + esc(err.message || 'Could not load progress.') + '</div>';
      }
    }
  }

  /* ===== Workout Split Tabs & Slot Grouping ===== */
  function getGroups() {
    var orderPref = ['Legs & Abs', 'Back & Biceps', 'Chest & Shoulders'];
    var seen = {};
    var out = [];
    orderPref.forEach(function(g) {
      if (exercises.some(function(ex) { return ex.group === g; })) {
        seen[g] = true;
        out.push(g);
      }
    });
    exercises.forEach(function(ex) {
      if (!seen[ex.group]) {
        seen[ex.group] = true;
        out.push(ex.group);
      }
    });
    return out;
  }

  function getSlotsForGroup(groupName) {
    var bySlot = {};
    var list = [];
    exercises
      .filter(function(ex) { return ex.group === groupName; })
      .forEach(function(ex) {
        if (!bySlot[ex.slotId]) {
          bySlot[ex.slotId] = {
            slotId: ex.slotId,
            group: ex.group,
            order: ex.order,
            muscle: ex.muscle,
            variants: []
          };
          list.push(bySlot[ex.slotId]);
        }
        bySlot[ex.slotId].variants.push(ex);
      });

    list.sort(function(a, b) { return a.order - b.order; });
    return list;
  }

  function getActiveVariant(slot) {
    for (var i = 0; i < slot.variants.length; i++) {
      if (slot.variants[i].isSelected) return slot.variants[i];
    }
    return slot.variants[0];
  }

  function isSlotDoneToday(slotId) {
    return todayWorkout.some(function(w) { return w.slotId === slotId; });
  }

  function renderSplitTabs() {
    var strip = document.getElementById('splitTabs');
    strip.innerHTML = '';
    var groups = getGroups();

    groups.forEach(function(g) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.role = 'tab';
      btn.className = 'split-tab' + (g === selectedGroup ? ' active' : '');
      btn.setAttribute('aria-selected', g === selectedGroup ? 'true' : 'false');
      btn.textContent = g
        .replace('Chest & Shoulders', 'Chest & Shld')
        .replace('Back & Biceps', 'Back & Bi');
      btn.addEventListener('click', function() {
        selectedGroup = g;
        expandedSlotId = '';
        renderSplitTabs();
        renderSlotList();
      });
      strip.appendChild(btn);
    });
  }

  /* ===== Render Full-Width Exercise Slot Bars ===== */
  function renderSlotList() {
    var container = document.getElementById('slotList');
    container.innerHTML = '';

    var slots = getSlotsForGroup(selectedGroup);
    if (!slots.length) {
      container.innerHTML = '<div class="state-msg">No exercises in this split yet. Tap + Add Exercise below.</div>';
      return;
    }

    slots.forEach(function(slot) {
      var active = getActiveVariant(slot);
      var done = isSlotDoneToday(slot.slotId);
      var isOpen = expandedSlotId === slot.slotId;

      var bar = document.createElement('article');
      bar.className = 'slot-bar' + (done ? ' done' : '') + (isOpen ? ' expanded' : '');
      bar.dataset.slotId = slot.slotId;

      var bumpHtml = active.cleanStreak >= 2
        ? '<span class="bump-pill" title="' + active.cleanStreak + ' clean sessions at ' + active.lastWeight + ' lb">&uarr; +5 lb</span>'
        : '';

      var doneHtml = done ? '<span class="done-check" title="Logged today">&#10003;</span>' : '';
      var wtText = active.lastWeight > 0 ? (active.lastWeight + ' lb') : 'BW';

      var variantOptsHtml = slot.variants.map(function(v) {
        var sel = v.exercise === active.exercise ? ' selected' : '';
        var wHint = v.lastWeight > 0 ? ' (' + v.lastWeight + ' lb)' : '';
        return '<option value="' + esc(v.exercise) + '"' + sel + '>' + esc(v.exercise + wHint) + '</option>';
      }).join('');

      bar.innerHTML =
        '<div class="slot-row">' +
          '<button type="button" class="drag-handle" aria-label="Reorder ' + esc(slot.muscle) + ' (' + esc(active.exercise) + ')" aria-pressed="false">&#8942;&#8942;</button>' +
          '<button type="button" class="slot-summary-btn" aria-expanded="' + (isOpen ? 'true' : 'false') + '">' +
            '<span class="muscle-tag">' + esc(slot.muscle) + '</span>' +
            '<span class="slot-title-group">' +
              '<span class="slot-ex-name">' + esc(active.exercise) + '</span>' +
              bumpHtml +
            '</span>' +
          '</button>' +
          '<div class="slot-right">' +
            '<span class="slot-weight">' + esc(wtText) + '</span>' +
            doneHtml +
            '<span class="bar-chevron" aria-hidden="true">&#x203A;</span>' +
          '</div>' +
        '</div>' +
        '<div class="reorder-hint" aria-hidden="true" hidden>Arrows to move &middot; Space to drop &middot; Esc to cancel</div>' +
        '<div class="slot-drawer"' + (isOpen ? '' : ' hidden') + '>' +
          '<div class="variant-row">' +
            '<select class="variant-select" aria-label="Select movement for ' + esc(slot.muscle) + '">' + variantOptsHtml + '</select>' +
            '<button type="button" class="mini-btn add-variant-btn">+ Variant</button>' +
            '<span class="goal-hint">Goal ' + esc(active.goalSets) + '&times;' + esc(active.goalReps) + '</span>' +
          '</div>' +
          '<div class="stepper-strip">' +
            '<div class="step-cell">' +
              '<span class="step-lbl">Sets</span>' +
              '<div class="step-box">' +
                '<button type="button" class="step-btn" data-field="sets" data-delta="-1">&minus;</button>' +
                '<input type="number" inputmode="numeric" class="step-inp inp-sets" value="' + esc(active.lastSets) + '" min="1">' +
                '<button type="button" class="step-btn" data-field="sets" data-delta="1">+</button>' +
              '</div>' +
            '</div>' +
            '<div class="step-cell">' +
              '<span class="step-lbl">Reps</span>' +
              '<div class="step-box">' +
                '<button type="button" class="step-btn" data-field="reps" data-delta="-1">&minus;</button>' +
                '<input type="number" inputmode="numeric" class="step-inp inp-reps" value="' + esc(active.lastReps) + '" min="1">' +
                '<button type="button" class="step-btn" data-field="reps" data-delta="1">+</button>' +
              '</div>' +
            '</div>' +
            '<div class="step-cell">' +
              '<span class="step-lbl">Lbs</span>' +
              '<div class="step-box">' +
                '<button type="button" class="step-btn" data-field="weight" data-delta="-5">&minus;</button>' +
                '<input type="number" inputmode="decimal" class="step-inp inp-weight" value="' + esc(active.lastWeight) + '" min="0" step="2.5">' +
                '<button type="button" class="step-btn" data-field="weight" data-delta="5">+</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="effort-row" role="group" aria-label="Set 3 result">' +
            '<button type="button" class="effort-pill active" data-effort="clean">Clean &#10003;</button>' +
            '<button type="button" class="effort-pill" data-effort="fail_s3">Failed Set 3</button>' +
            '<button type="button" class="effort-pill" data-effort="fail_early">Form / Early Fail</button>' +
          '</div>' +
          '<div class="note-box">' +
            '<textarea class="note-area inp-note" rows="1" placeholder="Sticky note / setup cue...">' + esc(active.stickyNote) + '</textarea>' +
            '<button type="button" class="clear-btn">Clear</button>' +
          '</div>' +
          '<div class="action-strip">' +
            '<button type="button" class="primary-btn log-slot-btn">Log Set</button>' +
            '<button type="button" class="rest-trigger-btn" data-rest="60">60s</button>' +
            '<button type="button" class="rest-trigger-btn" data-rest="90">90s</button>' +
          '</div>' +
        '</div>';

      wireSlotBar(bar, slot);
      container.appendChild(bar);

      if (isOpen) {
        var ta = bar.querySelector('.inp-note');
        if (ta) autoResize(ta);
      }
    });
  }

  function wireSlotBar(bar, slot) {
    var summaryBtn = bar.querySelector('.slot-summary-btn');
    var rightSide = bar.querySelector('.slot-right');
    var drawer = bar.querySelector('.slot-drawer');

    function toggleExpand() {
      var nowOpen = !bar.classList.contains('expanded');
      document.querySelectorAll('#slotList .slot-bar').forEach(function(other) {
        other.classList.remove('expanded');
        var d = other.querySelector('.slot-drawer');
        var b = other.querySelector('.slot-summary-btn');
        if (d) d.hidden = true;
        if (b) b.setAttribute('aria-expanded', 'false');
      });

      if (nowOpen) {
        expandedSlotId = slot.slotId;
        bar.classList.add('expanded');
        drawer.hidden = false;
        summaryBtn.setAttribute('aria-expanded', 'true');
        var ta = bar.querySelector('.inp-note');
        if (ta) autoResize(ta);
        bar.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else {
        expandedSlotId = '';
      }
    }

    summaryBtn.addEventListener('click', toggleExpand);
    rightSide.addEventListener('click', toggleExpand);

    // Variant switcher
    var varSelect = bar.querySelector('.variant-select');
    varSelect.addEventListener('change', function() {
      var chosenName = varSelect.value;
      slot.variants.forEach(function(v) {
        v.isSelected = (v.exercise === chosenName);
      });
      renderSlotList();
      apiCall('v2_selectVariant', { slotId: slot.slotId, exercise: chosenName }).catch(function() {});
    });

    // + Variant trigger
    bar.querySelector('.add-variant-btn').addEventListener('click', function() {
      openAddExerciseDialog('variant', slot);
    });

    // Steppers
    bar.querySelectorAll('.step-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var delta = parseFloat(btn.dataset.delta);
        var inp = btn.parentElement.querySelector('input');
        var min = inp.min !== '' ? parseFloat(inp.min) : 0;
        var next = (parseFloat(inp.value) || 0) + delta;
        if (next >= min) inp.value = next;
      });
    });

    // Effort pills
    bar.querySelectorAll('.effort-pill').forEach(function(pill) {
      pill.addEventListener('click', function() {
        bar.querySelectorAll('.effort-pill').forEach(function(p) { p.classList.remove('active'); });
        pill.classList.add('active');
      });
    });

    // Sticky note
    var noteInp = bar.querySelector('.inp-note');
    noteInp.addEventListener('input', function() { autoResize(noteInp); });
    bar.querySelector('.clear-btn').addEventListener('click', function() {
      noteInp.value = '';
      autoResize(noteInp);
    });

    // Log Set
    var logBtn = bar.querySelector('.log-slot-btn');
    logBtn.addEventListener('click', function() {
      submitSlotWorkout(bar, slot, logBtn);
    });

    // 10-foot circular timer triggers
    bar.querySelectorAll('.rest-trigger-btn').forEach(function(rBtn) {
      rBtn.addEventListener('click', function() {
        var active = getActiveVariant(slot);
        openCircularTimer(Number(rBtn.dataset.rest) || 60, active.exercise);
      });
    });

    // Drag & keyboard reorder wiring on handle
    var handle = bar.querySelector('.drag-handle');
    setupPointerDrag(handle, bar);
    setupKeyboardReorder(handle, bar);
  }

  async function submitSlotWorkout(bar, slot, btn) {
    var active = getActiveVariant(slot);
    var activeEffortEl = bar.querySelector('.effort-pill.active');
    var payload = {
      group: slot.group,
      slotId: slot.slotId,
      muscle: slot.muscle,
      exercise: active.exercise,
      sets: Number(bar.querySelector('.inp-sets').value) || active.goalSets,
      reps: Number(bar.querySelector('.inp-reps').value) || active.goalReps,
      weight: Number(bar.querySelector('.inp-weight').value) || 0,
      effort: activeEffortEl ? activeEffortEl.dataset.effort : 'clean',
      note: bar.querySelector('.inp-note').value.trim()
    };

    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
      var res = await apiCall('v2_logWorkout', { data: payload });
      if (res.exercises) exercises = res.exercises;
      if (res.todayWorkout) todayWorkout = res.todayWorkout;
      historyLoaded = false;

      btn.disabled = false;
      btn.classList.add('saved');
      btn.textContent = '✓ Logged';
      bar.classList.add('done');

      var wtSpan = bar.querySelector('.slot-weight');
      if (wtSpan) wtSpan.textContent = payload.weight > 0 ? (payload.weight + ' lb') : 'BW';

      var rightSide = bar.querySelector('.slot-right');
      if (rightSide && !rightSide.querySelector('.done-check')) {
        var chk = document.createElement('span');
        chk.className = 'done-check';
        chk.textContent = '✓';
        rightSide.insertBefore(chk, rightSide.querySelector('.bar-chevron'));
      }

      renderTodaySummary();

      setTimeout(function() {
        btn.classList.remove('saved');
        btn.textContent = 'Log Set';
      }, 1600);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Log Set';
      if (err.code !== 'UNAUTHORIZED') {
        alert('Could not save set: ' + (err.message || err));
      }
    }
  }

  /* ===== Pointer & Keyboard Drag-and-Drop Reordering ===== */
  var dragState = null;

  function moveElementBefore(parent, item, refNode) {
    if ('moveBefore' in Element.prototype) {
      parent.moveBefore(item, refNode || null);
    } else if (refNode) {
      refNode.before(item);
    } else {
      parent.append(item);
    }
  }

  function announceReorder(text) {
    var live = document.getElementById('reorderLive');
    if (!live) return;
    live.textContent = '';
    setTimeout(function() { live.textContent = text; }, 120);
  }

  function persistCurrentDomOrder() {
    var list = document.getElementById('slotList');
    var bars = Array.from(list.querySelectorAll('.slot-bar'));
    var slotOrder = bars.map(function(b) { return b.dataset.slotId; });

    var orderMap = {};
    slotOrder.forEach(function(id, i) { orderMap[id] = i + 1; });
    exercises.forEach(function(ex) {
      if (ex.group === selectedGroup && orderMap[ex.slotId]) {
        ex.order = orderMap[ex.slotId];
      }
    });

    apiCall('v2_reorderSlots', { group: selectedGroup, slotOrder: slotOrder }).catch(function() {});
  }

  function setupPointerDrag(handle, bar) {
    handle.addEventListener('pointerdown', function(e) {
      if (e.button !== 0 || dragState) return;
      e.preventDefault();

      var list = document.getElementById('slotList');
      var bars = Array.from(list.querySelectorAll('.slot-bar'));
      if (bars.length < 2) return;

      handle.setPointerCapture(e.pointerId);
      bar.getAnimations().forEach(function(a) { a.finish(); });

      dragState = {
        pointerId: e.pointerId,
        handle: handle,
        bar: bar,
        list: list,
        startClientY: e.clientY,
        startScrollY: window.scrollY,
        lastClientY: e.clientY,
        refNode: undefined, // undefined = no-op
        rafId: 0
      };

      document.documentElement.classList.add('is-dragging');
      bar.classList.add('is-grabbed');

      function updatePositionAndMarker() {
        if (!dragState) return;
        var scrollDelta = window.scrollY - dragState.startScrollY;
        var dy = (dragState.lastClientY - dragState.startClientY) + scrollDelta;
        bar.style.translate = '0px ' + dy + 'px';

        var listRect = list.getBoundingClientRect();
        var relY = Math.max(0, Math.min(list.offsetHeight, dragState.lastClientY - listRect.top));
        var siblings = Array.from(list.querySelectorAll('.slot-bar'));

        var targetRef = null;
        for (var i = 0; i < siblings.length; i++) {
          var sib = siblings[i];
          var mid = sib.offsetTop + sib.offsetHeight / 2;
          if (relY < mid) {
            targetRef = sib;
            break;
          }
        }

        // Skip no-op drop (dropping before self or before current nextElementSibling)
        if (targetRef === bar || targetRef === bar.nextElementSibling) {
          dragState.refNode = undefined;
          list.removeAttribute('data-drop');
          return;
        }

        dragState.refNode = targetRef;
        var markerY;
        if (targetRef) {
          var prev = targetRef.previousElementSibling;
          var rNext = targetRef.getBoundingClientRect();
          if (prev && prev !== bar) {
            var rPrev = prev.getBoundingClientRect();
            markerY = (rPrev.bottom + rNext.top) / 2;
          } else {
            markerY = rNext.top;
          }
        } else {
          var lastEl = siblings[siblings.length - 1];
          markerY = lastEl.getBoundingClientRect().bottom;
        }

        list.setAttribute('data-drop', 'true');
        list.style.setProperty('--drop-x', listRect.left + 'px');
        list.style.setProperty('--drop-w', listRect.width + 'px');
        list.style.setProperty('--drop-y', markerY + 'px');
      }

      // Edge auto-scroll loop while dragging on small mobile viewports
      var prevFrame = performance.now();
      function autoScrollTick(now) {
        if (!dragState) return;
        var dt = Math.min(40, now - prevFrame) / 1000;
        prevFrame = now;
        var zone = Math.min(90, window.innerHeight / 3);
        var vy = 0;
        if (dragState.lastClientY < zone) {
          vy = -420 * ((zone - dragState.lastClientY) / zone);
        } else if (dragState.lastClientY > window.innerHeight - zone) {
          vy = 420 * ((dragState.lastClientY - (window.innerHeight - zone)) / zone);
        }
        if (vy !== 0) {
          window.scrollBy(0, vy * dt);
          updatePositionAndMarker();
        }
        dragState.rafId = requestAnimationFrame(autoScrollTick);
      }
      dragState.rafId = requestAnimationFrame(autoScrollTick);

      function onMove(ev) {
        if (!dragState || ev.pointerId !== dragState.pointerId) return;
        dragState.lastClientY = ev.clientY;
        updatePositionAndMarker();
      }

      function finishDrag(cancelled) {
        if (!dragState) return;
        var st = dragState;
        dragState = null;
        cancelAnimationFrame(st.rafId);
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onCancel);
        document.removeEventListener('keydown', onEsc);

        document.documentElement.classList.remove('is-dragging');
        st.list.removeAttribute('data-drop');
        st.list.style.removeProperty('--drop-x');
        st.list.style.removeProperty('--drop-y');
        st.list.style.removeProperty('--drop-w');

        var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        var allBars = Array.from(st.list.querySelectorAll('.slot-bar'));
        var beforeRects = new Map();
        allBars.forEach(function(b) { beforeRects.set(b, b.getBoundingClientRect()); });

        st.bar.style.translate = '';

        var moved = false;
        if (!cancelled && st.refNode !== undefined) {
          moveElementBefore(st.list, st.bar, st.refNode);
          moved = true;
        }

        st.bar.scrollIntoView({ block: 'nearest', inline: 'nearest' });

        if (!reduced) {
          allBars.forEach(function(b) {
            var oldR = beforeRects.get(b);
            var newR = b.getBoundingClientRect();
            var dy = oldR.top - newR.top;
            if (Math.abs(dy) > 1) {
              b.animate(
                [{ translate: '0px ' + dy + 'px' }, { translate: '0px 0px' }],
                { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' }
              );
            }
          });
        }

        st.bar.classList.remove('is-grabbed');

        if (cancelled) {
          announceReorder('Reorder canceled.');
        } else if (moved) {
          var updated = Array.from(st.list.querySelectorAll('.slot-bar'));
          var newPos = updated.indexOf(st.bar) + 1;
          var label = st.bar.querySelector('.slot-ex-name').textContent;
          announceReorder(label + ' moved to position ' + newPos + ' of ' + updated.length + '.');
          persistCurrentDomOrder();
        }
      }

      function onUp(ev) {
        if (!dragState || ev.pointerId !== dragState.pointerId) return;
        finishDrag(false);
      }

      function onCancel(ev) {
        if (!dragState || ev.pointerId !== dragState.pointerId) return;
        finishDrag(true);
      }

      function onEsc(ev) {
        if (ev.key === 'Escape') {
          ev.preventDefault();
          finishDrag(true);
        }
      }

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onCancel);
      document.addEventListener('keydown', onEsc);
    });
  }

  function setupKeyboardReorder(handle, bar) {
    var origNextSibling = null;
    var suppressBlur = false;

    handle.addEventListener('keydown', function(e) {
      var list = document.getElementById('slotList');
      var grabbed = handle.getAttribute('aria-pressed') === 'true';
      var hint = bar.querySelector('.reorder-hint');

      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (!grabbed) {
          origNextSibling = bar.nextElementSibling;
          handle.setAttribute('aria-pressed', 'true');
          bar.classList.add('is-grabbed');
          if (hint) hint.hidden = false;
          announceReorder('Picked up. Use Up and Down arrows to move, Space to drop, Escape to cancel.');
        } else {
          handle.setAttribute('aria-pressed', 'false');
          bar.classList.remove('is-grabbed');
          if (hint) hint.hidden = true;
          persistCurrentDomOrder();
          var all = Array.from(list.querySelectorAll('.slot-bar'));
          announceReorder('Dropped at position ' + (all.indexOf(bar) + 1) + ' of ' + all.length + '.');
        }
        return;
      }

      if (!grabbed) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        suppressBlur = true;
        moveElementBefore(list, bar, origNextSibling);
        handle.setAttribute('aria-pressed', 'false');
        bar.classList.remove('is-grabbed');
        if (hint) hint.hidden = true;
        bar.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        handle.focus({ preventScroll: true });
        suppressBlur = false;
        announceReorder('Reorder canceled.');
        return;
      }

      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        var targetRef = e.key === 'ArrowUp'
          ? bar.previousElementSibling
          : (bar.nextElementSibling ? bar.nextElementSibling.nextElementSibling : undefined);
        if (e.key === 'ArrowUp' && !bar.previousElementSibling) return;
        if (e.key === 'ArrowDown' && !bar.nextElementSibling) return;

        suppressBlur = true;
        moveElementBefore(list, bar, targetRef || null);
        bar.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        handle.focus({ preventScroll: true });
        suppressBlur = false;

        var items = Array.from(list.querySelectorAll('.slot-bar'));
        announceReorder('Position ' + (items.indexOf(bar) + 1) + ' of ' + items.length + '.');
      }
    });

    handle.addEventListener('blur', function() {
      if (suppressBlur) return;
      if (handle.getAttribute('aria-pressed') === 'true') {
        handle.setAttribute('aria-pressed', 'false');
        bar.classList.remove('is-grabbed');
        var hint = bar.querySelector('.reorder-hint');
        if (hint) hint.hidden = true;
        persistCurrentDomOrder();
      }
    });
  }

  /* ===== 10-Foot Full-Screen Circular Rest Timer + Wake Lock ===== */
  async function acquireWakeLock() {
    try {
      if ('wakeLock' in navigator && !wakeLockSentinel) {
        wakeLockSentinel = await navigator.wakeLock.request('screen');
        wakeLockSentinel.addEventListener('release', function() {
          wakeLockSentinel = null;
        });
      }
    } catch (e) {}
  }

  function releaseWakeLock() {
    if (wakeLockSentinel) {
      wakeLockSentinel.release().catch(function() {});
      wakeLockSentinel = null;
    }
  }

  function openCircularTimer(seconds, exerciseName) {
    var dlg = document.getElementById('timerDialog');
    var circle = document.getElementById('timerCircle');
    var titleEl = document.getElementById('timerTitle');
    var badgeEl = document.getElementById('timerStateBadge');

    clearInterval(timerTickId);
    timerFinished = false;
    timerTotalMs = seconds * 1000;
    timerEndMs = Date.now() + timerTotalMs;

    titleEl.textContent = exerciseName || 'Rest Timer';
    badgeEl.textContent = 'Resting';
    dlg.classList.remove('timer-finished');
    circle.classList.remove('urgent', 'done');
    circle.style.strokeDasharray = String(RING_CIRCUMFERENCE);
    circle.style.strokeDashoffset = '0';

    if (!dlg.open) dlg.showModal();
    acquireWakeLock();
    renderTimerFrame();
    timerTickId = setInterval(renderTimerFrame, 200);
  }

  function renderTimerFrame() {
    var dlg = document.getElementById('timerDialog');
    var circle = document.getElementById('timerCircle');
    var digitsEl = document.getElementById('timerDigits');
    var unitEl = document.getElementById('timerUnit');
    var badgeEl = document.getElementById('timerStateBadge');

    var remainingMs = Math.max(0, timerEndMs - Date.now());
    var secsLeft = Math.ceil(remainingMs / 1000);

    if (remainingMs <= 0) {
      if (!timerFinished) {
        timerFinished = true;
        clearInterval(timerTickId);
        timerTickId = null;
        digitsEl.textContent = 'GO';
        unitEl.textContent = 'next set';
        badgeEl.textContent = 'Time Up';
        dlg.classList.add('timer-finished');
        circle.classList.remove('urgent');
        circle.classList.add('done');
        circle.style.strokeDashoffset = '0';
        playDoubleBeep();
      }
      return;
    }

    digitsEl.textContent = String(secsLeft);
    unitEl.textContent = secsLeft === 1 ? 'second' : 'seconds';

    var fracRemaining = Math.max(0, Math.min(1, remainingMs / timerTotalMs));
    var offset = RING_CIRCUMFERENCE * (1 - fracRemaining);
    circle.style.strokeDashoffset = String(offset);

    if (secsLeft <= 15) circle.classList.add('urgent');
    else circle.classList.remove('urgent');
  }

  function adjustTimerSeconds(deltaSec) {
    var deltaMs = deltaSec * 1000;
    if (timerFinished) {
      if (deltaSec > 0) openCircularTimer(deltaSec, document.getElementById('timerTitle').textContent);
      return;
    }
    timerEndMs += deltaMs;
    timerTotalMs = Math.max(timerTotalMs, timerEndMs - Date.now());
    renderTimerFrame();
  }

  function closeCircularTimer() {
    clearInterval(timerTickId);
    timerTickId = null;
    releaseWakeLock();
    var dlg = document.getElementById('timerDialog');
    if (dlg.open) dlg.close();
  }

  function playDoubleBeep() {
    try {
      var AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      var ctx = new AudioCtx();
      [[0, 0.28], [0.36, 0.68]].forEach(function(pair) {
        var o = ctx.createOscillator();
        var g = ctx.createGain();
        o.connect(g);
        g.connect(ctx.destination);
        o.type = 'sine';
        o.frequency.value = 880;
        g.gain.value = 0.35;
        o.start(ctx.currentTime + pair[0]);
        o.stop(ctx.currentTime + pair[1]);
      });
    } catch (e) {}
  }

  /* ===== Cardio Finisher (Arm Crank & StairMaster) ===== */
  function prefillCardioInputs() {
    var lastAc = lastCardio['Arm Crank'];
    if (lastAc) {
      if (lastAc.minutes) document.getElementById('acMinutes').value = lastAc.minutes;
      if (lastAc.avgWatts !== '') document.getElementById('acAvgWatts').placeholder = String(lastAc.avgWatts);
      if (lastAc.peakWatts !== '') document.getElementById('acPeakWatts').placeholder = String(lastAc.peakWatts);
      if (lastAc.miles !== '') document.getElementById('acMiles').placeholder = String(lastAc.miles);
      if (lastAc.calories !== '') document.getElementById('acCalories').placeholder = String(lastAc.calories);
    }

    var lastSm = lastCardio.StairMaster;
    if (lastSm) {
      if (lastSm.floors) document.getElementById('smFloors').value = lastSm.floors;
      if (lastSm.minutes !== '') document.getElementById('smMinutes').placeholder = String(lastSm.minutes);
      if (lastSm.level !== '') document.getElementById('smLevel').placeholder = String(lastSm.level);
    }

    syncCardioNoteField();
  }

  function syncCardioNoteField() {
    var last = lastCardio[activeCardioMachine];
    var noteEl = document.getElementById('cardioNote');
    noteEl.value = (last && last.note) ? last.note : '';
    autoResize(noteEl);
  }

  function renderCardioHeaderStatus() {
    var statusEl = document.getElementById('cardioHeaderStatus');
    if (!todayCardio.length) {
      statusEl.textContent = '';
      return;
    }
    statusEl.textContent = '✓ ' + todayCardio.map(function(c) { return c.machine; }).join(' + ');
  }

  async function submitCardio() {
    var btn = document.getElementById('cardioSubmitBtn');
    var note = document.getElementById('cardioNote').value.trim();
    var payload = { machine: activeCardioMachine, note: note };

    if (activeCardioMachine === 'Arm Crank') {
      payload.minutes = document.getElementById('acMinutes').value;
      payload.avgWatts = document.getElementById('acAvgWatts').value;
      payload.peakWatts = document.getElementById('acPeakWatts').value;
      payload.miles = document.getElementById('acMiles').value;
      payload.calories = document.getElementById('acCalories').value;
      if (!payload.minutes) { alert('Enter Arm Crank duration (minutes).'); return; }
    } else {
      payload.floors = document.getElementById('smFloors').value;
      payload.minutes = document.getElementById('smMinutes').value;
      payload.level = document.getElementById('smLevel').value;
      if (!payload.floors) { alert('Enter StairMaster floors.'); return; }
    }

    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
      var res = await apiCall('v2_logCardio', { data: payload });
      if (res.todayCardio) todayCardio = res.todayCardio;
      if (res.lastCardio) lastCardio = res.lastCardio;
      historyLoaded = false;

      btn.disabled = false;
      btn.classList.add('saved');
      btn.textContent = '✓ Cardio Logged';
      renderCardioHeaderStatus();
      renderTodaySummary();

      setTimeout(function() {
        btn.classList.remove('saved');
        btn.textContent = 'Log Cardio';
      }, 1600);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Log Cardio';
      if (err.code !== 'UNAUTHORIZED') alert('Could not log cardio: ' + (err.message || err));
    }
  }

  /* ===== Today's Session Summary ===== */
  function renderTodaySummary() {
    var container = document.getElementById('todaySummary');
    if (!todayWorkout.length && !todayCardio.length) {
      container.innerHTML = '';
      return;
    }

    var totalLbs = 0;
    var lines = '';
    todayWorkout.forEach(function(w) {
      totalLbs += Number(w.sets) * Number(w.reps) * Number(w.weight);
      lines += '<div class="today-line"><strong>' + esc(w.exercise) + '</strong> &mdash; <span>' +
        esc(w.sets) + '&times;' + esc(w.reps) +
        (w.weight > 0 ? ' @ ' + esc(w.weight) + ' lb' : ' (BW)') + '</span></div>';
    });

    todayCardio.forEach(function(c) {
      var details = [];
      if (c.floors) details.push(c.floors + ' floors');
      if (c.minutes) details.push(c.minutes + ' min');
      if (c.avgWatts) details.push(c.avgWatts + (c.peakWatts ? '/' + c.peakWatts : '') + ' W');
      if (c.miles) details.push(c.miles + ' mi');
      lines += '<div class="today-line"><strong>' + esc(c.machine) + '</strong> &mdash; <span>' +
        esc(details.join(' · ')) + '</span></div>';
    });

    container.innerHTML =
      '<div class="today-banner">' +
        '<div class="today-head">' +
          '<span class="today-lbl">Today\'s Session</span>' +
          (totalLbs > 0 ? '<span class="today-vol">' + totalLbs.toLocaleString() + ' lbs moved</span>' : '') +
        '</div>' +
        lines +
      '</div>';
  }

  /* ===== In-App + Add Exercise / Variant Modal ===== */
  function openAddExerciseDialog(mode, slot) {
    var dlg = document.getElementById('addExerciseDialog');
    document.getElementById('addExError').hidden = true;
    document.getElementById('addExMode').value = mode;
    document.getElementById('addExName').value = '';
    document.getElementById('addExNote').value = '';

    var groupWrap = document.getElementById('addExGroupWrap');
    var muscleWrap = document.getElementById('addExMuscleWrap');
    var muscleInp = document.getElementById('addExMuscle');

    if (mode === 'variant' && slot) {
      document.getElementById('addExTitle').textContent = 'Add ' + slot.muscle + ' Variant';
      document.getElementById('addExSlotId').value = slot.slotId;
      document.getElementById('addExGroup').value = slot.group;
      muscleInp.value = slot.muscle;
      groupWrap.hidden = true;
      muscleWrap.hidden = true;
    } else {
      document.getElementById('addExTitle').textContent = 'Add Exercise';
      document.getElementById('addExSlotId').value = '';
      document.getElementById('addExGroup').value = selectedGroup || 'Back & Biceps';
      muscleInp.value = '';
      groupWrap.hidden = false;
      muscleWrap.hidden = false;
    }

    if (!dlg.open) dlg.showModal();
  }

  /* ===== Progress Dashboard (Both Literal Chips + Plain Total Pounds % Work) ===== */
  function renderProgress() {
    var splitBar = document.getElementById('progSplitFilter');
    splitBar.hidden = (progView === 'cardio');

    if (progView === 'muscles') renderProgressByMuscle();
    else if (progView === 'sessions') renderProgressSessions();
    else renderProgressCardio();
  }

  function getWindowCutoffStr(days) {
    var d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().split('T')[0];
  }

  function renderProgressByMuscle() {
    var container = document.getElementById('progContent');
    var cutoffStr = getWindowCutoffStr(historyWindowDays);
    var weekCutoffStr = getWindowCutoffStr(7);

    var filteredHist = allHistory.filter(function(h) {
      if (h.date < cutoffStr) return false;
      if (progSplit !== 'ALL' && h.group !== progSplit) return false;
      return true;
    });

    // Group exercises & history by Muscle
    var musclesMap = {};
    exercises.forEach(function(ex) {
      if (progSplit !== 'ALL' && ex.group !== progSplit) return;
      if (!musclesMap[ex.muscle]) {
        musclesMap[ex.muscle] = { muscle: ex.muscle, exercises: {}, weekSets: 0, windowSets: 0 };
      }
      musclesMap[ex.muscle].exercises[ex.exercise] = {
        meta: ex,
        entries: []
      };
    });

    filteredHist.forEach(function(h) {
      var m = h.muscle || 'Other';
      if (!musclesMap[m]) {
        musclesMap[m] = { muscle: m, exercises: {}, weekSets: 0, windowSets: 0 };
      }
      if (!musclesMap[m].exercises[h.exercise]) {
        musclesMap[m].exercises[h.exercise] = { meta: null, entries: [] };
      }
      musclesMap[m].exercises[h.exercise].entries.push(h);
      musclesMap[m].windowSets += Number(h.sets) || 0;
      if (h.date >= weekCutoffStr) {
        musclesMap[m].weekSets += Number(h.sets) || 0;
      }
    });

    var muscleNames = Object.keys(musclesMap);
    if (!muscleNames.length) {
      container.innerHTML = '<div class="state-msg">No muscle data in this window.</div>';
      return;
    }

    var weeksInWindow = Math.max(1, historyWindowDays / 7);
    var html = '';

    muscleNames.forEach(function(mName) {
      var mObj = musclesMap[mName];
      var exNames = Object.keys(mObj.exercises);
      var workPcts = [];
      var chipsHtml = '';
      var selectedMove = openMovementByMuscle[mName] || '';

      exNames.forEach(function(exName) {
        var bucket = mObj.exercises[exName];
        var entries = bucket.entries;
        var meta = bucket.meta;

        // Current working numbers: latest entry in window, or meta last values
        var curWeight = entries.length ? entries[entries.length - 1].weight : (meta ? meta.lastWeight : 0);
        var curSets = entries.length ? entries[entries.length - 1].sets : (meta ? meta.lastSets : 3);
        var curReps = entries.length ? entries[entries.length - 1].reps : (meta ? meta.lastReps : 12);

        // Day-1 baseline for this specific movement
        var base = baselines[exName];
        var startWt = base ? base.weight : (meta ? meta.startWeight : curWeight);
        var baseWork = base ? base.work : (curSets * curReps * (startWt > 0 ? startWt : 1));
        var curWork = curSets * curReps * (curWeight > 0 ? curWeight : 1);

        var lbDelta = curWeight - startWt;
        var workPct = (baseWork > 0 && entries.length > 0)
          ? Math.round(((curWork - baseWork) / baseWork) * 100)
          : null;

        if (workPct !== null) workPcts.push(workPct);

        var deltaParts = [];
        if (lbDelta > 0) deltaParts.push('+' + lbDelta + ' lb');
        if (workPct !== null && workPct > 0) deltaParts.push('+' + workPct + '%');

        var isChipOpen = selectedMove === exName;
        chipsHtml +=
          '<button type="button" class="move-chip' + (isChipOpen ? ' active' : '') + '" ' +
            'data-muscle="' + esc(mName) + '" data-exercise="' + esc(exName) + '">' +
            '<span>' + esc(exName) + '</span>' +
            '<span class="mc-wt">' + (curWeight > 0 ? esc(curWeight) + ' lb' : 'BW') + '</span>' +
            (deltaParts.length ? '<span class="mc-delta">' + esc(deltaParts.join(' · ')) + '</span>' : '') +
          '</button>';
      });

      var avgWorkPct = workPcts.length
        ? Math.round(workPcts.reduce(function(a, b) { return a + b; }, 0) / workPcts.length)
        : null;

      var setsLabel = mObj.weekSets > 0
        ? (mObj.weekSets + ' sets this wk')
        : (Math.round((mObj.windowSets / weeksInWindow) * 10) / 10 + ' sets/wk avg');

      var workBadgeHtml = avgWorkPct !== null
        ? '<span class="work-pct-badge' + (avgWorkPct > 0 ? ' pos' : '') + '">' +
            (avgWorkPct > 0 ? '+' : '') + avgWorkPct + '% total lbs</span>'
        : '';

      var detailHtml = '';
      if (selectedMove && mObj.exercises[selectedMove]) {
        detailHtml = buildMovementDetailHtml(selectedMove, mObj.exercises[selectedMove].entries);
      }

      html +=
        '<div class="muscle-prog-bar">' +
          '<div class="mp-head">' +
            '<div class="mp-title-wrap">' +
              '<span class="mp-muscle">' + esc(mName) + '</span>' +
              '<span class="mp-sets-wk">' + esc(setsLabel) + '</span>' +
            '</div>' +
            workBadgeHtml +
          '</div>' +
          '<div class="mp-chips">' + chipsHtml + '</div>' +
          detailHtml +
        '</div>';
    });

    container.innerHTML = html;
  }

  function buildMovementDetailHtml(exName, entries) {
    if (!entries || !entries.length) {
      return '<div class="move-detail"><div class="spark-head"><strong>' + esc(exName) +
        '</strong><span>No logged sessions in selected window</span></div></div>';
    }

    var weights = entries.map(function(e) { return Number(e.weight) || 0; });
    var minW = Math.min.apply(null, weights);
    var maxW = Math.max.apply(null, weights);
    var span = Math.max(5, maxW - minW);

    var pts = entries.map(function(e, idx) {
      var x = entries.length === 1 ? 150 : (12 + (idx / (entries.length - 1)) * 276);
      var y = 52 - (((Number(e.weight) || 0) - minW) / span) * 40;
      return x.toFixed(1) + ',' + y.toFixed(1);
    });

    var sparkSvg =
      '<svg class="spark-svg" viewBox="0 0 300 64" preserveAspectRatio="none" aria-hidden="true">' +
        '<polyline fill="none" stroke="var(--brand)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" points="' + pts.join(' ') + '"></polyline>' +
        pts.map(function(p) {
          var xy = p.split(',');
          return '<circle cx="' + xy[0] + '" cy="' + xy[1] + '" r="3.2" fill="var(--brand)"></circle>';
        }).join('') +
      '</svg>';

    var rowsHtml = entries.slice().reverse().slice(0, 12).map(function(e) {
      var totalMoved = (Number(e.sets) || 0) * (Number(e.reps) || 0) * (Number(e.weight) || 0);
      var dFmt = new Date(e.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return '<div>' +
        '<div class="hist-row">' +
          '<span class="hist-date">' + esc(dFmt) + (e.time ? ' · ' + esc(e.time) : '') + '</span>' +
          '<span class="hist-stats">' + esc(e.sets) + '&times;' + esc(e.reps) + ' @ ' + esc(e.weight) + ' lb (' + totalMoved.toLocaleString() + ' total)</span>' +
        '</div>' +
        (e.note ? '<div class="hist-note">' + esc(e.note) + '</div>' : '') +
      '</div>';
    }).join('');

    return '<div class="move-detail">' +
      '<div class="spark-head">' +
        '<strong>' + esc(exName) + '</strong>' +
        '<span>Range: ' + minW + ' &rarr; ' + maxW + ' lb (' + entries.length + ' sessions)</span>' +
      '</div>' +
      sparkSvg +
      rowsHtml +
    '</div>';
  }

  function renderProgressSessions() {
    var container = document.getElementById('progContent');
    var cutoffStr = getWindowCutoffStr(historyWindowDays);

    var filtered = allHistory.filter(function(h) {
      if (h.date < cutoffStr) return false;
      if (progSplit !== 'ALL' && h.group !== progSplit) return false;
      return true;
    });

    if (!filtered.length) {
      container.innerHTML = '<div class="state-msg">No sessions logged in this window.</div>';
      return;
    }

    var byDate = {};
    filtered.forEach(function(h) {
      if (!byDate[h.date]) byDate[h.date] = [];
      byDate[h.date].push(h);
    });

    var html = '';
    Object.keys(byDate).sort().reverse().forEach(function(date) {
      var rows = byDate[date];
      var vol = 0;
      rows.forEach(function(r) { vol += (Number(r.sets) || 0) * (Number(r.reps) || 0) * (Number(r.weight) || 0); });
      var dFmt = new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric'
      });
      var timeWindow = rows[0].time
        ? (rows[0].time + (rows.length > 1 && rows[rows.length - 1].time ? ' – ' + rows[rows.length - 1].time : ''))
        : '';

      html += '<div class="session-block">' +
        '<div class="session-block-head">' +
          '<span class="session-block-date">' + esc(dFmt) + (timeWindow ? ' · ' + esc(timeWindow) : '') + '</span>' +
          '<span class="session-block-vol">' + vol.toLocaleString() + ' lbs</span>' +
        '</div>' +
        rows.map(function(r) {
          return '<div>' +
            '<div class="hist-row">' +
              '<span><strong>' + esc(r.exercise) + '</strong> <span class="hist-date">(' + esc(r.muscle) + ')</span></span>' +
              '<span class="hist-stats">' + esc(r.sets) + '&times;' + esc(r.reps) + ' @ ' + esc(r.weight) + ' lb</span>' +
            '</div>' +
            (r.note ? '<div class="hist-note">' + esc(r.note) + '</div>' : '') +
          '</div>';
        }).join('') +
      '</div>';
    });

    container.innerHTML = html;
  }

  function renderProgressCardio() {
    var container = document.getElementById('progContent');
    var cutoffStr = getWindowCutoffStr(historyWindowDays);
    var rows = allCardioHistory.filter(function(c) { return c.date >= cutoffStr; });

    if (!rows.length) {
      container.innerHTML = '<div class="state-msg">No cardio logged in this window yet.</div>';
      return;
    }

    container.innerHTML = rows.slice().reverse().map(function(c) {
      var dFmt = new Date(c.date + 'T12:00:00').toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric'
      });
      var parts = [];
      if (c.floors != null) parts.push(c.floors + ' floors');
      if (c.minutes != null) parts.push(c.minutes + ' min');
      if (c.avgWatts != null) parts.push(c.avgWatts + (c.peakWatts != null ? '/' + c.peakWatts : '') + ' W');
      if (c.miles != null) parts.push(c.miles + ' mi');
      if (c.calories != null) parts.push(c.calories + ' cal');
      if (c.level != null) parts.push('Lvl ' + c.level);

      return '<div class="session-block">' +
        '<div class="session-block-head">' +
          '<span class="session-block-date">' + esc(c.machine) + '</span>' +
          '<span class="session-block-vol">' + esc(dFmt) + '</span>' +
        '</div>' +
        '<div class="hist-stats">' + esc(parts.join(' · ')) + '</div>' +
        (c.note ? '<div class="hist-note">' + esc(c.note) + '</div>' : '') +
      '</div>';
    }).join('');
  }

  /* ===== PWA Install & Dialog Fallbacks ===== */
  function setupInstallPrompt() {
    var installButton = document.getElementById('installAppBtn');
    var installStatus = document.getElementById('installStatus');
    var isStandalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
    if (isStandalone) return;

    var supportsWebInstall = typeof Navigator.prototype.install === 'function';
    var deferredInstallPrompt;

    if (supportsWebInstall) installButton.hidden = false;

    window.addEventListener('beforeinstallprompt', function(event) {
      event.preventDefault();
      deferredInstallPrompt = event;
      if (!supportsWebInstall) installButton.hidden = false;
    });

    installButton.addEventListener('click', async function() {
      if (installButton.getAttribute('aria-disabled') === 'true') return;
      installButton.setAttribute('aria-disabled', 'true');

      try {
        if (supportsWebInstall) {
          await navigator.install();
          installStatus.textContent = 'The app was installed or opened.';
          installButton.hidden = true;
        } else if (deferredInstallPrompt) {
          var promptEvent = deferredInstallPrompt;
          deferredInstallPrompt = undefined;
          await promptEvent.prompt();
          var choice = await promptEvent.userChoice;
          installStatus.textContent = choice.outcome === 'accepted'
            ? 'The app was installed.'
            : 'Installation canceled.';
          if (!deferredInstallPrompt) installButton.hidden = true;
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
        document.getElementById('overflowMenu').hidden = true;
      }
    });
  }

  function setupDialogFallbacks() {
    // Safari fallback for <dialog closedby="any">
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      var outside = function(e, dialog) {
        var r = dialog.getBoundingClientRect();
        return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      };
      document.querySelectorAll('dialog[closedby="any"]').forEach(function(dialog) {
        var pressedOutside = false;
        dialog.addEventListener('pointerdown', function(e) { pressedOutside = outside(e, dialog); });
        dialog.addEventListener('pointerup', function(e) {
          if (pressedOutside && outside(e, dialog)) dialog.close();
        });
      });
    }

    document.querySelectorAll('dialog').forEach(function(dialog) {
      dialog.addEventListener('close', function() {
        dialog.returnValue = '';
        if (dialog.id === 'timerDialog') {
          clearInterval(timerTickId);
          timerTickId = null;
          releaseWakeLock();
        }
      });
    });
  }

  function autoResize(ta) {
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  }

  /* ===== Initialization ===== */
  function init() {
    syncThemeMetaColor();
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncThemeMetaColor);
    window.addEventListener('storage', function(e) {
      if (e.key === STORAGE_SCHEME_KEY) applySchemeOverride(e.newValue || '');
    });

    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('/sw.js').catch(function() {});
    }

    setupInstallPrompt();
    setupDialogFallbacks();

    // Header actions
    document.getElementById('themeToggleBtn').addEventListener('click', toggleColorScheme);

    var menuBtn = document.getElementById('menuBtn');
    var overflowMenu = document.getElementById('overflowMenu');
    menuBtn.addEventListener('click', function() {
      overflowMenu.hidden = !overflowMenu.hidden;
    });
    document.addEventListener('click', function(e) {
      var wrap = document.querySelector('.menu-wrap');
      if (wrap && !wrap.contains(e.target)) overflowMenu.hidden = true;
    });

    document.querySelectorAll('#topNav .mode-tab').forEach(function(tab) {
      tab.addEventListener('click', function() { switchPage(tab.dataset.page, true); });
    });

    window.addEventListener('popstate', function() {
      var p = new URLSearchParams(window.location.search).get('page');
      switchPage(p === 'history' ? 'history' : 'workout', false);
    });

    // Sign out
    document.getElementById('signOutBtn').addEventListener('click', async function() {
      overflowMenu.hidden = true;
      var tok = getToken();
      showAuthGate();
      if (tok) {
        fetch(window.WORKOUT_CONFIG.GAS_API_URL, {
          method: 'POST',
          redirect: 'follow',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'logout', token: tok })
        }).catch(function() {});
      }
    });

    // Password toggle & Login submit
    var pwInput = document.getElementById('loginPassword');
    var togglePwBtn = document.getElementById('togglePwBtn');
    togglePwBtn.addEventListener('click', function() {
      var showing = pwInput.type === 'text';
      pwInput.type = showing ? 'password' : 'text';
      togglePwBtn.textContent = showing ? 'Show' : 'Hide';
      togglePwBtn.setAttribute('aria-pressed', showing ? 'false' : 'true');
    });

    document.getElementById('loginForm').addEventListener('submit', async function(e) {
      e.preventDefault();
      var username = document.getElementById('loginUsername').value.trim();
      var password = pwInput.value;
      var btn = document.getElementById('loginSubmitBtn');
      var errEl = document.getElementById('loginError');

      errEl.hidden = true;
      btn.disabled = true;
      btn.textContent = 'Signing in...';

      try {
        var res = await apiCall('login', { username: username, password: password });
        setToken(res.token);
        pwInput.value = '';
        await loadBootstrap();
      } catch (err) {
        errEl.textContent = err.message || 'Sign in failed.';
        errEl.hidden = false;
      } finally {
        btn.disabled = false;
        btn.textContent = 'Sign In';
      }
    });

    // Cardio bar wiring
    var cardioBar = document.getElementById('cardioBar');
    var cardioBody = document.getElementById('cardioBody');
    var cardioHeadBtn = document.getElementById('cardioHeaderBtn');
    cardioHeadBtn.addEventListener('click', function() {
      var open = !cardioBar.classList.contains('expanded');
      cardioBar.classList.toggle('expanded', open);
      cardioBody.hidden = !open;
      cardioHeadBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) autoResize(document.getElementById('cardioNote'));
    });

    document.querySelectorAll('#cardioMachineTabs .seg-pill').forEach(function(pill) {
      pill.addEventListener('click', function() {
        activeCardioMachine = pill.dataset.machine;
        document.querySelectorAll('#cardioMachineTabs .seg-pill').forEach(function(p) {
          p.classList.toggle('active', p === pill);
        });
        document.getElementById('armCrankFields').hidden = activeCardioMachine !== 'Arm Crank';
        document.getElementById('stairMasterFields').hidden = activeCardioMachine !== 'StairMaster';
        syncCardioNoteField();
      });
    });

    var cardioNote = document.getElementById('cardioNote');
    cardioNote.addEventListener('input', function() { autoResize(cardioNote); });
    document.getElementById('cardioNoteClear').addEventListener('click', function() {
      cardioNote.value = '';
      autoResize(cardioNote);
    });
    document.getElementById('cardioSubmitBtn').addEventListener('click', submitCardio);

    // Timer dialog buttons
    document.getElementById('timerCloseBtn').addEventListener('click', closeCircularTimer);
    document.getElementById('timerMinusBtn').addEventListener('click', function() { adjustTimerSeconds(-15); });
    document.getElementById('timerPlusBtn').addEventListener('click', function() { adjustTimerSeconds(15); });

    // + Add Exercise modal
    var addExDlg = document.getElementById('addExerciseDialog');
    document.getElementById('openAddSlotBtn').addEventListener('click', function() {
      openAddExerciseDialog('slot', null);
    });
    document.getElementById('closeAddExBtn').addEventListener('click', function() { addExDlg.close(); });
    document.getElementById('cancelAddExBtn').addEventListener('click', function() { addExDlg.close(); });

    document.getElementById('addExerciseForm').addEventListener('submit', async function(e) {
      e.preventDefault();
      var errEl = document.getElementById('addExError');
      var submitBtn = document.getElementById('submitAddExBtn');
      errEl.hidden = true;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving...';

      var payload = {
        mode: document.getElementById('addExMode').value,
        slotId: document.getElementById('addExSlotId').value,
        group: document.getElementById('addExGroup').value,
        muscle: document.getElementById('addExMuscle').value.trim(),
        exercise: document.getElementById('addExName').value.trim(),
        goalSets: Number(document.getElementById('addExSets').value) || 3,
        goalReps: Number(document.getElementById('addExReps').value) || 12,
        startWeight: Number(document.getElementById('addExWeight').value) || 0,
        note: document.getElementById('addExNote').value.trim()
      };

      try {
        var res = await apiCall('v2_addExercise', { data: payload });
        if (res.exercises) exercises = res.exercises;
        selectedGroup = payload.group || selectedGroup;
        expandedSlotId = res.slotId || expandedSlotId;
        historyLoaded = false;
        addExDlg.close();
        renderSplitTabs();
        renderSlotList();
      } catch (err) {
        errEl.textContent = err.message || 'Could not add exercise.';
        errEl.hidden = false;
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Save Exercise';
      }
    });

    // Progress toolbar & chip delegation
    document.querySelectorAll('#progViewTabs .seg-pill').forEach(function(pill) {
      pill.addEventListener('click', function() {
        progView = pill.dataset.pview;
        document.querySelectorAll('#progViewTabs .seg-pill').forEach(function(p) {
          p.classList.toggle('active', p === pill);
        });
        renderProgress();
      });
    });

    document.getElementById('progRangeSelect').addEventListener('change', function(e) {
      historyWindowDays = parseInt(e.target.value, 10) || 90;
      renderProgress();
    });

    document.querySelectorAll('#progSplitFilter .filter-chip').forEach(function(chip) {
      chip.addEventListener('click', function() {
        progSplit = chip.dataset.split;
        document.querySelectorAll('#progSplitFilter .filter-chip').forEach(function(c) {
          c.classList.toggle('active', c === chip);
        });
        renderProgress();
      });
    });

    document.getElementById('progContent').addEventListener('click', function(e) {
      var chip = e.target.closest('.move-chip');
      if (!chip) return;
      var muscle = chip.dataset.muscle;
      var ex = chip.dataset.exercise;
      openMovementByMuscle[muscle] = (openMovementByMuscle[muscle] === ex) ? '' : ex;
      renderProgressByMuscle();
    });

    // Initial route & session check
    if (new URLSearchParams(window.location.search).get('page') === 'history') {
      currentPage = 'history';
    }

    if (getToken()) loadBootstrap();
    else showAuthGate();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
