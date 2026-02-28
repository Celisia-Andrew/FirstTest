/* ═══════════════════════════════════════════════════════════════════════
   ui.js — Screen management, rendering helpers, and timer logic.

   All DOM manipulation lives here.  app.js calls these functions and
   provides callbacks; it never touches the DOM directly.
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
   Renders:  "a × b = ?"  with the "?" in accent color.
───────────────────────────────────────────── */
function renderProblem(containerEl, displayStr) {
  // displayStr is like "3 × 4" — we append " = ?"
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
   Returns a controller object { stop, reset }.
───────────────────────────────────────────── */
function createCountdownTimer(totalSeconds, timerEl, progressEl, onTick, onExpire) {
  let remaining = totalSeconds;
  let intervalId = null;
  let startTime = null;
  let elapsed = 0;

  function tick() {
    elapsed = (Date.now() - startTime) / 1000;
    remaining = Math.max(0, totalSeconds - elapsed);

    const mins = Math.floor(remaining / 60);
    const secs = Math.floor(remaining % 60);
    timerEl.textContent = `${mins}:${String(secs).padStart(2, '0')}`;

    if (remaining <= 10) timerEl.classList.add('urgent');

    if (progressEl) {
      const pct = ((totalSeconds - remaining) / totalSeconds) * 100;
      progressEl.style.width = pct + '%';
    }

    if (onTick) onTick(elapsed, remaining);

    if (remaining <= 0) {
      clearInterval(intervalId);
      if (onExpire) onExpire(elapsed);
    }
  }

  function start() {
    startTime = Date.now();
    intervalId = setInterval(tick, 100); // 100ms resolution for accuracy
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
   Briefly flashes the input border green or red.
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
   MESSAGE SCREEN
   Shows a text message with a "Continue" button.
   onContinue: callback when button clicked.
───────────────────────────────────────────── */
function showMessage(text, onContinue) {
  document.getElementById('message-text').textContent = text;
  showScreen('screen-message');

  const btn = document.getElementById('btn-message-continue');
  // Remove any lingering listener
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
  document.getElementById('level-complete-dcpm').textContent  = dcpm >= 0 ? `${Math.round(dcpm)} DCPM` : '';
  showScreen('screen-level-complete');

  const btn = document.getElementById('btn-level-continue');
  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);
  newBtn.addEventListener('click', onContinue, { once: true });

  // TODO: Gamification hook — fire 'levelMastered' event for medals/awards UI
  // document.dispatchEvent(new CustomEvent('levelMastered', { detail: { dcpm } }));
}

/* ─────────────────────────────────────────────
   FOCUS HELPER — always keep input focused
───────────────────────────────────────────── */
function focusInput(inputEl) {
  if (inputEl) {
    inputEl.value = '';
    inputEl.focus({ preventScroll: true });
  }
}

/* ─────────────────────────────────────────────
   ERROR CORRECTION PANEL
───────────────────────────────────────────── */
function showErrorPanel(correctDisplay, correctAnswer) {
  const panel = document.getElementById('error-panel');
  const msg   = document.getElementById('error-msg');
  msg.innerHTML = `Correct answer: <strong>${escapeHtml(correctDisplay)} = ${correctAnswer}</strong><br>
                   Type <strong>${correctAnswer}</strong> to continue.`;
  panel.classList.remove('hidden');
  const input = document.getElementById('error-input');
  input.value = '';
  input.focus({ preventScroll: true });
}

function hideErrorPanel() {
  document.getElementById('error-panel').classList.add('hidden');
}

/* ─────────────────────────────────────────────
   HIGH FLUENCY SCREEN
───────────────────────────────────────────── */
function showHighFluency(dcpm, onRetake) {
  document.getElementById('high-fluency-dcpm').textContent = `${Math.round(dcpm)} DCPM`;
  showScreen('screen-high-fluency');

  const btn = document.getElementById('btn-retake');
  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);
  newBtn.addEventListener('click', onRetake, { once: true });
}
