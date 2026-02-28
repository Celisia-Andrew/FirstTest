/* ═══════════════════════════════════════════════════════════════════════
   app.js — Main application controller.

   Orchestrates all state transitions:
     Welcome → Baseline → (High Fluency | Diagnostic → Placement)
             → Practice (IR loop) → Mastery Check → Level Test → next level

   Input handling (auto-advance) and error correction are also here.

   Future auth integration:
     Replace initApp() bootstrap with a Google OAuth / Clever callback that
     sets `currentUser` before calling initApp().  All game logic below is
     already isolated from identity.  Search for "TODO: AUTH" to find hooks.
════════════════════════════════════════════════════════════════════════ */

'use strict';

/* ─────────────────────────────────────────────
   APP STATE
───────────────────────────────────────────── */
let studentData = null;  // loaded from localStorage via data.js

// Active test / practice session state
const session = {
  facts: [],           // array of problem cards for current test
  index: 0,           // current position in facts array
  correctDigits: 0,   // running total of correct digits
  timer: null,        // countdown timer controller
};

// IR practice state
const irState = {
  levelKey: '',       // e.g. 'A'
  factIndex: 0,       // which fact in the level we are practising
  sequence: [],       // full IR card sequence for current unknown
  seqIndex: 0,        // position within IR sequence
  inErrorCorrection: false,
  errorExpectedAnswer: null,
};

// Diagnostic state
const diagState = {
  startKey: 'A',
  endKey: 'M',
  round: 0,
};

/* ─────────────────────────────────────────────
   BOOTSTRAP
───────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  // TODO: AUTH — swap this block with OAuth callback once auth is ready
  studentData = loadStudentData();
  studentData.sessionStartMs = Date.now();
  saveStudentData(studentData);

  // Wire up static buttons
  document.getElementById('btn-start').addEventListener('click', startBaseline);

  showScreen('screen-welcome');
});

/* ─────────────────────────────────────────────
   BASELINE TEST  (2-minute, all facts A-Z)
───────────────────────────────────────────── */
function startBaseline() {
  session.facts         = buildBaselineFacts();
  session.index         = 0;
  session.correctDigits = 0;

  const timerEl    = document.getElementById('baseline-timer');
  const progressEl = document.getElementById('baseline-progress');
  const scoreEl    = document.getElementById('baseline-score');
  const problemEl  = document.getElementById('baseline-problem');
  const inputEl    = document.getElementById('baseline-input');

  showScreen('screen-baseline');
  renderProblem(problemEl, session.facts[0].display);
  focusInput(inputEl);
  scoreEl.textContent = '0 digits';

  session.timer = createCountdownTimer(120, timerEl, progressEl, null, (elapsed) => {
    finishBaseline(elapsed);
  });
  session.timer.start();

  // Attach input handler (single listener via replace trick)
  attachInputHandler(inputEl, handleBaselineInput);
}

function handleBaselineInput(inputEl) {
  const card = session.facts[session.index];
  const typed = inputEl.value.trim();
  if (typed === '') return;

  const correctStr = String(card.answer);

  // Auto-advance when digit count matches correct answer length
  const shouldEvaluate = typed.length >= correctStr.length ||
                         (typed.length > 0 && typed.endsWith('\n')); // enter is stripped; see keydown handler

  if (!shouldEvaluate) return;

  const digits = countCorrectDigits(card.answer, parseInt(typed, 10));
  session.correctDigits += digits;
  updateScoreDisplay(document.getElementById('baseline-score'), session.correctDigits);
  flashInput(inputEl, digits === correctStr.length);

  session.index++;
  if (session.index >= session.facts.length) {
    session.timer.stop();
    finishBaseline(session.timer.getElapsed());
    return;
  }
  renderProblem(document.getElementById('baseline-problem'), session.facts[session.index].display);
  focusInput(inputEl);
}

function finishBaseline(elapsed) {
  removeInputHandler(document.getElementById('baseline-input'));
  const dcpm = calculateDCPM(session.correctDigits, elapsed);
  recordDCPM(studentData, 'baseline', dcpm);

  if (dcpm >= 40) {
    showHighFluency(dcpm, () => startBaseline());
  } else {
    // Enter diagnostic mode
    startDiagnostic('A', 'M');
  }
}

/* ─────────────────────────────────────────────
   DIAGNOSTIC MODE  (binary search, 1-min subtests)
───────────────────────────────────────────── */
function startDiagnostic(startKey, endKey) {
  diagState.startKey = startKey;
  diagState.endKey   = endKey;

  session.facts         = buildDiagnosticFacts(startKey, endKey);
  session.index         = 0;
  session.correctDigits = 0;

  const timerEl    = document.getElementById('diag-timer');
  const progressEl = document.getElementById('diag-progress');
  const scoreEl    = document.getElementById('diag-score');
  const problemEl  = document.getElementById('diag-problem');
  const inputEl    = document.getElementById('diag-input');

  document.getElementById('diag-timer').textContent = '1:00';
  timerEl.classList.remove('urgent');
  showScreen('screen-diagnostic');
  renderProblem(problemEl, session.facts[0].display);
  focusInput(inputEl);
  scoreEl.textContent = '0 digits';

  session.timer = createCountdownTimer(60, timerEl, progressEl, null, (elapsed) => {
    finishDiagnostic(elapsed);
  });
  session.timer.start();

  attachInputHandler(inputEl, handleDiagInput);
}

function handleDiagInput(inputEl) {
  const card      = session.facts[session.index];
  const typed     = inputEl.value.trim();
  if (typed === '') return;

  const correctStr = String(card.answer);
  if (typed.length < correctStr.length) return; // wait for more digits

  const digits = countCorrectDigits(card.answer, parseInt(typed, 10));
  session.correctDigits += digits;
  updateScoreDisplay(document.getElementById('diag-score'), session.correctDigits);
  flashInput(inputEl, digits === correctStr.length);

  session.index++;
  if (session.index >= session.facts.length) {
    session.timer.stop();
    finishDiagnostic(session.timer.getElapsed());
    return;
  }
  renderProblem(document.getElementById('diag-problem'), session.facts[session.index].display);
  focusInput(inputEl);
}

function finishDiagnostic(elapsed) {
  removeInputHandler(document.getElementById('diag-input'));
  const dcpm   = calculateDCPM(session.correctDigits, elapsed);
  const passed = dcpm >= 40;

  studentData.diagnosticHistory.push({
    date: new Date().toISOString(),
    rangeStart: diagState.startKey,
    rangeEnd:   diagState.endKey,
    dcpm:       Math.round(dcpm * 10) / 10,
  });
  recordDCPM(studentData, 'diagnostic', dcpm);

  const result = advanceDiagnostic(diagState.startKey, diagState.endKey, passed);

  if (result.done) {
    // Place the student
    const level = result.placementLevel;
    studentData.currentLevel     = level;
    studentData.currentFactIndex = 0;
    saveStudentData(studentData);
    showMessage(
      `Great effort! We'll start your practice at Level ${level}.`,
      () => startPracticeLevel(level)
    );
  } else {
    // Next diagnostic round
    startDiagnostic(result.nextStart, result.nextEnd);
  }
}

/* ─────────────────────────────────────────────
   PRACTICE  — Incremental Rehearsal
───────────────────────────────────────────── */
function startPracticeLevel(levelKey) {
  irState.levelKey   = levelKey;
  irState.factIndex  = studentData.currentFactIndex || 0;
  practiceNextFact();
}

function practiceNextFact() {
  const levelKey  = irState.levelKey;
  const facts     = LEVEL_MAP[levelKey].facts;

  if (irState.factIndex >= facts.length) {
    // All facts in this level done — run the end-of-level test
    runLevelTest(levelKey);
    return;
  }

  const unknown = facts[irState.factIndex];
  irState.seqIndex = 0;

  // Build pool of known facts: all mastered facts + prior facts in this level
  const masteredFacts = studentData.masteredFacts.map(k => parseFactKey(k));
  // Also include previously practised (not yet formally "mastered") facts in this level
  const priorInLevel  = facts.slice(0, irState.factIndex).map(f => f);
  const knownPool     = [...masteredFacts, ...priorInLevel];

  const isLevelA = (levelKey === 'A');
  irState.sequence = generateIRSequence(unknown, knownPool, isLevelA);

  // Update UI labels
  document.getElementById('practice-level-label').textContent =
    `Level ${levelKey} – Fact ${irState.factIndex + 1}/${facts.length}`;
  document.getElementById('practice-timer').textContent = '';
  document.getElementById('practice-fact-progress').textContent =
    `Step 1/${irState.sequence.length}`;

  const progressEl = document.getElementById('practice-progress');
  progressEl.style.width = '0%';

  showScreen('screen-practice');
  hideErrorPanel();
  displayIRCard();
}

function displayIRCard() {
  const card    = irState.sequence[irState.seqIndex];
  const total   = irState.sequence.length;
  const current = irState.seqIndex + 1;

  renderProblem(document.getElementById('practice-problem'), card.display);
  document.getElementById('practice-fact-progress').textContent = `Step ${current}/${total}`;
  document.getElementById('practice-progress').style.width = `${(current / total) * 100}%`;

  const inputEl = document.getElementById('practice-input');
  focusInput(inputEl);
  attachInputHandler(inputEl, handlePracticeInput);
}

function handlePracticeInput(inputEl) {
  if (irState.inErrorCorrection) return; // handled by error-input listener

  const card       = irState.sequence[irState.seqIndex];
  const typed      = inputEl.value.trim();
  if (typed === '') return;

  const correctStr = String(card.answer);
  if (typed.length < correctStr.length) return;

  const isCorrect = parseInt(typed, 10) === card.answer;
  flashInput(inputEl, isCorrect);

  if (!isCorrect) {
    // Error correction: show correct answer, require re-type, then restart IR for this fact
    irState.inErrorCorrection  = true;
    irState.errorExpectedAnswer = card.answer;
    showErrorPanel(card.display, card.answer);
    attachErrorCorrectionHandler();
    return;
  }

  // Correct — advance IR sequence
  irState.seqIndex++;
  if (irState.seqIndex >= irState.sequence.length) {
    // IR sequence complete — check if this was U1 (the unknown)
    // and run mastery check
    const unknown = LEVEL_MAP[irState.levelKey].facts[irState.factIndex];
    runMasteryCheck(unknown);
    return;
  }
  displayIRCard();
}

function attachErrorCorrectionHandler() {
  const errorInput = document.getElementById('error-input');
  errorInput.value = '';
  errorInput.focus({ preventScroll: true });

  const onInput = () => {
    const typed = errorInput.value.trim();
    if (typed === '') return;
    if (typed.length >= String(irState.errorExpectedAnswer).length) {
      if (parseInt(typed, 10) === irState.errorExpectedAnswer) {
        // Correct re-type — restart IR sequence for this unknown
        irState.inErrorCorrection = false;
        hideErrorPanel();
        irState.seqIndex = 0;

        // Rebuild sequence (same unknown, same pool — restart from scratch)
        const levelKey  = irState.levelKey;
        const facts     = LEVEL_MAP[levelKey].facts;
        const unknown   = facts[irState.factIndex];
        const masteredFacts = studentData.masteredFacts.map(k => parseFactKey(k));
        const priorInLevel  = facts.slice(0, irState.factIndex);
        const knownPool     = [...masteredFacts, ...priorInLevel];
        const isLevelA      = (levelKey === 'A');
        irState.sequence    = generateIRSequence(unknown, knownPool, isLevelA);

        removeInputHandler(errorInput);
        displayIRCard();
      } else {
        errorInput.value = '';
        errorInput.focus({ preventScroll: true });
      }
    }
  };

  attachInputHandler(errorInput, () => onInput());
}

/* ─────────────────────────────────────────────
   MASTERY CHECK  (1-minute test for current unknown U1)
───────────────────────────────────────────── */
function runMasteryCheck(unknown) {
  const allMastered = studentData.masteredFacts.map(k => parseFactKey(k));
  const checkFacts  = buildMasteryCheckSequence(unknown, allMastered);

  session.facts         = checkFacts;
  session.index         = 0;
  session.correctDigits = 0;

  const label      = `Mastery Check: ${unknown[0]} × ${unknown[1]}`;
  const timerEl    = document.getElementById('mastery-timer');
  const progressEl = document.getElementById('mastery-progress');
  const scoreEl    = document.getElementById('mastery-score');
  const problemEl  = document.getElementById('mastery-problem');
  const inputEl    = document.getElementById('mastery-input');

  document.getElementById('mastery-check-label').textContent = label;
  timerEl.textContent = '1:00';
  timerEl.classList.remove('urgent');
  scoreEl.textContent = '0 digits';
  showScreen('screen-mastery-check');
  renderProblem(problemEl, checkFacts[0].display);
  focusInput(inputEl);

  session.timer = createCountdownTimer(60, timerEl, progressEl, null, (elapsed) => {
    finishMasteryCheck(elapsed, unknown);
  });
  session.timer.start();

  attachInputHandler(inputEl, (el) => handleTimedTestInput(el,
    document.getElementById('mastery-problem'),
    scoreEl,
    () => {
      session.timer.stop();
      finishMasteryCheck(session.timer.getElapsed(), unknown);
    }
  ));
}

function finishMasteryCheck(elapsed, unknown) {
  removeInputHandler(document.getElementById('mastery-input'));
  const dcpm   = calculateDCPM(session.correctDigits, elapsed);
  const passed = dcpm >= 40;

  recordDCPM(studentData, 'mastery-check', dcpm);

  if (passed) {
    // Mark fact as mastered
    const key = factKey(unknown);
    if (!studentData.masteredFacts.includes(key)) {
      studentData.masteredFacts.push(key);
    }
    saveStudentData(studentData);

    showMessage(
      `You've worked hard to memorize ${unknown[0]} × ${unknown[1]}. Congratulations!`,
      () => {
        irState.factIndex++;
        studentData.currentFactIndex = irState.factIndex;
        saveStudentData(studentData);
        practiceNextFact();
      }
    );
  } else {
    showMessage(
      `You're almost there! Use positive self-talk and practice just a little bit more.`,
      () => practiceNextFact() // restart IR for same fact (factIndex unchanged)
    );
  }
}

/* ─────────────────────────────────────────────
   LEVEL TEST  (1-minute, current level + all mastered)
───────────────────────────────────────────── */
function runLevelTest(levelKey) {
  const testFacts = buildLevelTestFacts(levelKey, studentData.masteredFacts);

  session.facts         = testFacts;
  session.index         = 0;
  session.correctDigits = 0;

  const timerEl    = document.getElementById('level-test-timer');
  const progressEl = document.getElementById('level-test-progress');
  const scoreEl    = document.getElementById('level-test-score');
  const problemEl  = document.getElementById('level-test-problem');
  const inputEl    = document.getElementById('level-test-input');

  document.getElementById('level-test-label').textContent = `Level ${levelKey} Test`;
  timerEl.textContent = '1:00';
  timerEl.classList.remove('urgent');
  scoreEl.textContent = '0 digits';
  showScreen('screen-level-test');
  renderProblem(problemEl, testFacts[0].display);
  focusInput(inputEl);

  session.timer = createCountdownTimer(60, timerEl, progressEl, null, (elapsed) => {
    finishLevelTest(elapsed, levelKey);
  });
  session.timer.start();

  attachInputHandler(inputEl, (el) => handleTimedTestInput(el,
    problemEl,
    scoreEl,
    () => {
      session.timer.stop();
      finishLevelTest(session.timer.getElapsed(), levelKey);
    }
  ));
}

function finishLevelTest(elapsed, levelKey) {
  removeInputHandler(document.getElementById('level-test-input'));
  const dcpm   = calculateDCPM(session.correctDigits, elapsed);
  const passed = dcpm >= 40;

  recordDCPM(studentData, 'level-test', dcpm);

  if (passed) {
    // Mark level mastered, advance to next level
    if (!studentData.masteredLevels.includes(levelKey)) {
      studentData.masteredLevels.push(levelKey);
    }

    const nextIdx   = LEVEL_ORDER.indexOf(levelKey) + 1;
    const nextLevel = nextIdx < LEVEL_ORDER.length ? LEVEL_ORDER[nextIdx] : null;

    studentData.currentLevel     = nextLevel || levelKey;
    studentData.currentFactIndex = 0;
    saveStudentData(studentData);

    // TODO: Gamification hook — trigger medal/award event here
    // document.dispatchEvent(new CustomEvent('levelMastered', { detail: { levelKey, dcpm } }));

    if (nextLevel) {
      showLevelComplete(
        `Level ${levelKey} Complete!`,
        `Great work! Moving on to Level ${nextLevel}.`,
        dcpm,
        () => startPracticeLevel(nextLevel)
      );
    } else {
      showLevelComplete(
        'All Levels Complete!',
        'You have mastered all multiplication facts. Show this to your teacher!',
        dcpm,
        () => showScreen('screen-welcome')
      );
    }
  } else {
    // Fail: return to IR practice for same level
    irState.factIndex = 0;
    studentData.currentFactIndex = 0;
    saveStudentData(studentData);

    showMessage(
      `Keep going! Practice Level ${levelKey} a bit more. You're getting there!`,
      () => startPracticeLevel(levelKey)
    );
  }
}

/* ─────────────────────────────────────────────
   GENERIC TIMED-TEST INPUT HANDLER
   Used by mastery check and level test.
───────────────────────────────────────────── */
function handleTimedTestInput(inputEl, problemEl, scoreEl, onExhausted) {
  const card      = session.facts[session.index];
  const typed     = inputEl.value.trim();
  if (typed === '') return;

  const correctStr = String(card.answer);
  if (typed.length < correctStr.length) return;

  const digits = countCorrectDigits(card.answer, parseInt(typed, 10));
  session.correctDigits += digits;
  updateScoreDisplay(scoreEl, session.correctDigits);
  flashInput(inputEl, digits === correctStr.length);

  session.index++;
  if (session.index >= session.facts.length) {
    onExhausted();
    return;
  }
  renderProblem(problemEl, session.facts[session.index].display);
  focusInput(inputEl);
}

/* ─────────────────────────────────────────────
   INPUT HANDLER MANAGEMENT
   We attach a single "input" event listener per input element,
   plus a keydown listener to handle Enter key (submit partial answer).

   The replace-node trick in ui.js cannot be used here because we need
   to keep the same element for auto-focus continuity.  Instead, we store
   handler references on the element itself and replace them.
───────────────────────────────────────────── */
function attachInputHandler(inputEl, handler) {
  // Remove previous listeners
  removeInputHandler(inputEl);

  // Wrap handler so Enter key also triggers evaluation even for short answers
  const onInput = () => handler(inputEl);

  const onKeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // Force evaluation even if typed length < expected length (submitted wrong)
      const typed = inputEl.value.trim();
      if (typed === '') return;

      // Temporarily signal the handler to evaluate by appending a newline flag
      // We handle this by directly evaluating the card here:
      forceEvaluate(inputEl);
    }
  };

  inputEl._mfInputHandler   = onInput;
  inputEl._mfKeydownHandler = onKeydown;
  inputEl.addEventListener('input',   onInput);
  inputEl.addEventListener('keydown', onKeydown);
}

function removeInputHandler(inputEl) {
  if (!inputEl) return;
  if (inputEl._mfInputHandler)   { inputEl.removeEventListener('input',   inputEl._mfInputHandler); }
  if (inputEl._mfKeydownHandler) { inputEl.removeEventListener('keydown', inputEl._mfKeydownHandler); }
  inputEl._mfInputHandler   = null;
  inputEl._mfKeydownHandler = null;
}

/**
 * forceEvaluate — called when Enter is pressed.
 * Looks at which screen is active and calls the appropriate handler with a
 * "short answer is ok" flag.  If the typed value is shorter than expected,
 * it is treated as WRONG (scored 0 digits correct) and we advance.
 */
function forceEvaluate(inputEl) {
  const typed = inputEl.value.trim();
  if (typed === '') return;

  // Identify active screen
  const activeScreen = document.querySelector('.screen.active');
  if (!activeScreen) return;
  const id = activeScreen.id;

  function submitToSession(scoreEl, problemEl, onExhausted) {
    const card       = session.facts[session.index];
    const digits     = countCorrectDigits(card.answer, parseInt(typed, 10));
    session.correctDigits += digits;
    if (scoreEl) updateScoreDisplay(scoreEl, session.correctDigits);
    flashInput(inputEl, parseInt(typed, 10) === card.answer);
    session.index++;
    if (session.index >= session.facts.length) {
      onExhausted();
      return;
    }
    renderProblem(problemEl, session.facts[session.index].display);
    focusInput(inputEl);
  }

  if (id === 'screen-baseline') {
    submitToSession(
      document.getElementById('baseline-score'),
      document.getElementById('baseline-problem'),
      () => { session.timer.stop(); finishBaseline(session.timer.getElapsed()); }
    );
  } else if (id === 'screen-diagnostic') {
    submitToSession(
      document.getElementById('diag-score'),
      document.getElementById('diag-problem'),
      () => { session.timer.stop(); finishDiagnostic(session.timer.getElapsed()); }
    );
  } else if (id === 'screen-practice') {
    if (irState.inErrorCorrection) return;
    const card      = irState.sequence[irState.seqIndex];
    const isCorrect = parseInt(typed, 10) === card.answer;
    flashInput(inputEl, isCorrect);
    if (!isCorrect) {
      irState.inErrorCorrection  = true;
      irState.errorExpectedAnswer = card.answer;
      showErrorPanel(card.display, card.answer);
      attachErrorCorrectionHandler();
    } else {
      inputEl.value = '';
      irState.seqIndex++;
      if (irState.seqIndex >= irState.sequence.length) {
        const unknown = LEVEL_MAP[irState.levelKey].facts[irState.factIndex];
        runMasteryCheck(unknown);
      } else {
        displayIRCard();
      }
    }
  } else if (id === 'screen-mastery-check') {
    submitToSession(
      document.getElementById('mastery-score'),
      document.getElementById('mastery-problem'),
      () => { session.timer.stop(); finishMasteryCheck(session.timer.getElapsed(), LEVEL_MAP[irState.levelKey].facts[irState.factIndex]); }
    );
  } else if (id === 'screen-level-test') {
    submitToSession(
      document.getElementById('level-test-score'),
      document.getElementById('level-test-problem'),
      () => { session.timer.stop(); finishLevelTest(session.timer.getElapsed(), irState.levelKey); }
    );
  }
}
