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
───────────────────────────────────────────── */
function renderProblem(containerEl, displayStr) {
  containerEl.innerHTML = `${escapeHtml(displayStr)} = <span class="answer-part">?</span>`;
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
   FLASH FEEDBACK
───────────────────────────────────────────── */
function flashInput(inputEl, correct) {
  const cls = correct ? 'correct' : 'wrong';
  inputEl.classList.add(cls);
  setTimeout(() => inputEl.classList.remove(cls), 350);
}

/* ─────────────────────────────────────────────
   SCORE DISPLAY
───────────────────────────────────────────── */
function updateScoreDisplay(scoreEl, correctDigits) {
  scoreEl.textContent = `${correctDigits} digits`;
}

/* ─────────────────────────────────────────────
   DIAGNOSTIC INTRO SCREEN  (#1)
   Shows between baseline-fail and first subtest, and between subtests.

   @param {number}   subtestNum  1-based subtest counter
   @param {string}   rangeLabel  e.g. "Levels A–M"
   @param {Function} onStart     Called when student clicks Start
───────────────────────────────────────────── */
function showDiagIntro(subtestNum, rangeLabel, onStart) {
  document.getElementById('diag-intro-subtest').textContent =
    `Diagnostic Subtest ${subtestNum}  ·  ${rangeLabel}`;
  showScreen('screen-diag-intro');

  const btn    = document.getElementById('btn-diag-start');
  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);
  newBtn.addEventListener('click', onStart, { once: true });
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

  // TODO: Gamification hook — fire 'levelMastered' CustomEvent here
  // document.dispatchEvent(new CustomEvent('levelMastered', { detail: { dcpm } }));
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
