/* ═══════════════════════════════════════════════════════════════════════
   ui.js — Screen management, rendering helpers, timer logic.

   All DOM manipulation lives here.  app.js calls these and provides
   callbacks; it never touches the DOM directly.
════════════════════════════════════════════════════════════════════════ */

'use strict';

/* ─────────────────────────────────────────────
   SCREEN SWITCHER
───────────────────────────────────────────── */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(id);
  if (target) target.classList.add('active');
}

/* ─────────────────────────────────────────────
   PROBLEM DISPLAY
   Renders: "a × b = ?" with the "?" in accent color.
   Applies 100ms fade-in animation on each new fact.
───────────────────────────────────────────── */
function renderProblem(containerEl, displayStr) {
  containerEl.classList.remove('fact-fade');
  // Force reflow to restart the animation
  void containerEl.offsetWidth;
  containerEl.innerHTML = `${escapeHtml(displayStr)} = <span class="answer-part">?</span>`;
  containerEl.classList.add('fact-fade');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* ─────────────────────────────────────────────
   COUNTDOWN TIMER
   Returns { start, stop, getElapsed }.
───────────────────────────────────────────── */
function createCountdownTimer(totalSeconds, timerEl, progressEl, onTick, onExpire) {
  let intervalId = null;
  let startTime  = null;
  let elapsed    = 0;

  function tick() {
    elapsed          = (Date.now() - startTime) / 1000;
    const remaining  = Math.max(0, totalSeconds - elapsed);

    const mins = Math.floor(remaining / 60);
    const secs = Math.floor(remaining % 60);
    timerEl.textContent = `${mins}:${String(secs).padStart(2, '0')}`;

    if (remaining <= 10) timerEl.classList.add('urgent');

    if (progressEl) {
      progressEl.style.width = `${((totalSeconds - remaining) / totalSeconds) * 100}%`;
    }

    if (onTick) onTick(elapsed, remaining);

    if (remaining <= 0) {
      clearInterval(intervalId);
      if (onExpire) onExpire(elapsed);
    }
  }

  function start() {
    startTime  = Date.now();
    intervalId = setInterval(tick, 100);
  }

  function stop() {
    clearInterval(intervalId);
    return elapsed;
  }

  function getElapsed() { return elapsed; }

  return { start, stop, getElapsed };
}

/* ─────────────────────────────────────────────
   SNAP-ZOOM COUNTDOWN OVERLAY  (#7)
   Shows 3 → 2 → 1 → GO! before timed tests.
   Colors: 3=deep blue, 2=cyan, 1=gold, GO!=neon green
   Calls onComplete when GO! finishes fading.
───────────────────────────────────────────── */
function showCountdown(onComplete) {
  const overlay   = document.getElementById('countdown-overlay');
  const numberEl  = document.getElementById('countdown-number');
  const steps = [
    { text: '3',   color: '#1F51FF', shadow: '#1F51FF', anim: 'countdownSlam 0.7s ease-out forwards' },
    { text: '2',   color: '#00FFFF', shadow: '#00FFFF', anim: 'countdownSlam 0.7s ease-out forwards' },
    { text: '1',   color: '#FFD700', shadow: '#FFD700', anim: 'countdownSlam 0.7s ease-out forwards' },
    { text: 'GO!', color: '#39FF14', shadow: '#39FF14', anim: 'goSlam 0.7s ease-out forwards' },
  ];

  overlay.classList.remove('hidden');
  let stepIdx = 0;

  function runStep() {
    if (stepIdx >= steps.length) {
      overlay.classList.add('hidden');
      onComplete();
      return;
    }
    const step = steps[stepIdx++];
    numberEl.textContent = step.text;
    numberEl.style.color      = step.color;
    numberEl.style.textShadow = `0 0 30px ${step.shadow}, 0 0 60px ${step.shadow}`;
    numberEl.style.animation  = 'none';
    void numberEl.offsetWidth; // reflow to restart animation
    numberEl.style.animation  = step.anim;

    const delay = step.text === 'GO!' ? 700 : 700;
    setTimeout(runStep, delay);
  }

  runStep();
}

/* ─────────────────────────────────────────────
   FLASH FEEDBACK
───────────────────────────────────────────── */
function flashInput(inputEl, correct) {
  const cls = correct ? 'correct' : 'wrong';
  inputEl.classList.add(cls);
  setTimeout(() => inputEl.classList.remove(cls), 350);
}

/* ─────────────────────────────────────────────
   ANSWER ECHO  (#6)
   Shows a floating ghost of the typed answer rising above the input.
   isCorrect controls the color (green/red).
───────────────────────────────────────────── */
function showAnswerEcho(inputEl, displayText, isCorrect) {
  const rect  = inputEl.getBoundingClientRect();
  const ghost = document.createElement('div');
  ghost.className = `answer-echo ${isCorrect ? 'correct' : 'wrong'}`;
  ghost.textContent = displayText;
  // Anchor to the horizontal center of the input; the CSS animation bakes
  // translateX(-50%) into both keyframes so there is zero horizontal drift.
  ghost.style.left = `${rect.left + rect.width / 2}px`;
  ghost.style.top  = `${rect.top}px`;
  document.body.appendChild(ghost);
  setTimeout(() => ghost.remove(), 500);
}

/* ─────────────────────────────────────────────
   SCORE DISPLAY  (kept for compatibility, hidden in timed screens)
───────────────────────────────────────────── */
function updateScoreDisplay(scoreEl, correctDigits) {
  if (scoreEl) scoreEl.textContent = `${correctDigits} digits`;
}

/* ─────────────────────────────────────────────
   MESSAGE SCREEN
───────────────────────────────────────────── */
function showMessage(text, onContinue) {
  document.getElementById('message-text').textContent = text;
  showScreen('screen-message');

  const btn    = document.getElementById('btn-message-continue');
  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);
  newBtn.addEventListener('click', onContinue, { once: true });
}

/* ─────────────────────────────────────────────
   LEVEL COMPLETE SCREEN
───────────────────────────────────────────── */
function showLevelComplete(title, msg, dcpm, onContinue) {
  document.getElementById('level-complete-title').textContent = title;
  document.getElementById('level-complete-msg').textContent   = msg;
  document.getElementById('level-complete-dcpm').textContent  =
    dcpm >= 0 ? `${Math.round(dcpm)} DCPM` : '';
  showScreen('screen-level-complete');

  const btn    = document.getElementById('btn-level-continue');
  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);
  newBtn.addEventListener('click', onContinue, { once: true });
}

/* ─────────────────────────────────────────────
   HIGH FLUENCY SCREEN
───────────────────────────────────────────── */
function showHighFluency(dcpm, onRetake) {
  document.getElementById('high-fluency-dcpm').textContent = `${Math.round(dcpm)} DCPM`;
  showScreen('screen-high-fluency');

  const btn    = document.getElementById('btn-retake');
  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);
  newBtn.addEventListener('click', onRetake, { once: true });
}

/* ─────────────────────────────────────────────
   FOCUS HELPER
───────────────────────────────────────────── */
function focusInput(inputEl) {
  if (inputEl) {
    inputEl.value = '';
    inputEl.focus({ preventScroll: true });
  }
}

/* ─────────────────────────────────────────────
   ERROR CORRECTION PANEL  (#3 — DI Interactive Rehearsal)

   Shows:
     Header:  "Correct fact: A × B = P"
     Sub:     "Type the correct product to continue."
     Row:     "A × B = [input]"

   The practice-input is hidden while error panel is visible so the
   student focuses on the correction field.
───────────────────────────────────────────── */
function showErrorPanel(a, b, product) {
  document.getElementById('error-header').textContent =
    `Correct fact: ${a} × ${b} = ${product}`;
  document.getElementById('error-eq-display').textContent =
    `${a} × ${b} = `;

  document.getElementById('practice-input').style.display = 'none';

  const panel = document.getElementById('error-panel');
  panel.classList.remove('hidden');

  const input = document.getElementById('error-input');
  input.value = '';
  input.focus({ preventScroll: true });
}

function hideErrorPanel() {
  document.getElementById('error-panel').classList.add('hidden');
  document.getElementById('practice-input').style.display = '';
}

/* ─────────────────────────────────────────────
   FACT PROGRESS SCREEN  (#9)
   Shows after each fact mastered within a level.
   Segmented progress bar, next-fact preview, Start Practice button.

   @param {string}   levelKey      Current level key (e.g. 'B')
   @param {number}   completedIdx  Number of facts completed so far (0-based count)
   @param {number}   totalFacts    Total facts in this level
   @param {number[]|null} nextFact Next [a,b] fact, or null if level is done
   @param {string}   praise        Praise string from getRandomPraise()
   @param {Function} onStart       Called when student clicks Start Practice
───────────────────────────────────────────── */
function showFactProgress(levelKey, completedIdx, totalFacts, nextFact, praise, onStart) {
  document.getElementById('fact-progress-level-title').textContent =
    `Level ${levelKey} Progress`;

  // Build segmented bar
  const barEl = document.getElementById('fact-progress-bar');
  barEl.innerHTML = '';
  for (let i = 0; i < totalFacts; i++) {
    const seg = document.createElement('div');
    seg.className = 'level-seg';
    if (i < completedIdx) seg.classList.add('completed');
    else if (i === completedIdx) seg.classList.add('current');
    barEl.appendChild(seg);
  }

  // Next-fact preview
  const nextEl = document.getElementById('fact-progress-next');
  if (nextFact) {
    const product = nextFact[0] * nextFact[1];
    nextEl.innerHTML =
      `Next up: ${nextFact[0]} × ${nextFact[1]} = <strong>${product}</strong>`;
  } else {
    nextEl.textContent = 'All facts practiced — level test coming up!';
  }

  // Praise
  document.getElementById('fact-progress-praise').textContent = praise;

  showScreen('screen-fact-progress');

  const btn    = document.getElementById('btn-fact-progress-start');
  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);
  newBtn.focus({ preventScroll: true });
  newBtn.addEventListener('click', onStart, { once: true });
  newBtn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); onStart(); }
  }, { once: true });
}

/* ─────────────────────────────────────────────
   NEW LEVEL WELCOME SCREEN  (#9)
   Shows after a level test pass.
   Praise header, large new-level letter, next-fact preview, Proceed button.

   @param {string}   newLevelKey   The level the student is advancing TO
   @param {number[]|null} nextFact First [a,b] fact of the new level (or null)
   @param {string}   praise        Praise string
   @param {Function} onProceed     Called when student clicks Let's Go!
───────────────────────────────────────────── */
function showNewLevel(newLevelKey, nextFact, praise, onProceed) {
  document.getElementById('new-level-praise').textContent = praise;
  document.getElementById('new-level-letter').textContent = `Level ${newLevelKey}`;

  const nextEl = document.getElementById('new-level-next');
  if (nextFact) {
    const product = nextFact[0] * nextFact[1];
    nextEl.innerHTML =
      `First fact: ${nextFact[0]} × ${nextFact[1]} = <strong>${product}</strong>`;
  } else {
    nextEl.textContent = '';
  }

  showScreen('screen-new-level');

  const btn    = document.getElementById('btn-new-level-proceed');
  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);
  newBtn.focus({ preventScroll: true });
  newBtn.addEventListener('click', onProceed, { once: true });
  newBtn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); onProceed(); }
  }, { once: true });
}

/* ─────────────────────────────────────────────
   MASTERY CHECK PREP SCREEN  (#2)
   Buffer between the last IR card and the mastery-check countdown.

   Displays: "[Praise]! You practiced this fact well. Now you're ready to
              flex your fluency!" in Cyber Green, plus a gold reminder line,
              then a large centered 'Begin' button.

   The button is auto-focused; click/Enter/Space trigger a 200ms fade-out
   and then call onBegin() (which runs the 3-2-1-GO! countdown).
───────────────────────────────────────────── */
function showMasteryPrep(praise, onBegin) {
  document.getElementById('mastery-prep-praise').textContent =
    `${praise} You practiced this fact well. Now you're ready to flex your fluency!`;

  showScreen('screen-mastery-prep');

  const btn    = document.getElementById('btn-mastery-prep-begin');
  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);
  newBtn.focus({ preventScroll: true });

  function trigger() {
    newBtn.removeEventListener('click',   trigger);
    newBtn.removeEventListener('keydown', onKey);
    const screen = document.getElementById('screen-mastery-prep');
    screen.classList.add('fading');
    setTimeout(() => {
      screen.classList.remove('fading');
      onBegin();
    }, 200);
  }

  function onKey(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      trigger();
    }
  }

  newBtn.addEventListener('click',   trigger);
  newBtn.addEventListener('keydown', onKey);
}
