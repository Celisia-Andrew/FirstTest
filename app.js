/* ═══════════════════════════════════════════════════════════════════════
   app.js — Main application controller.

   Flow:
     Welcome → Baseline (2 min) → High Fluency | Diag Intro → Diagnostic subtests
     → Placement → Practice (IR) → Mastery Check → Level Test → next level

   Updates implemented:
     #1  Diagnostic transition screen + proper binary search state machine
     #2  Level-weighted sampling; rule-based IR for Levels A & F
     #3  DI-style error correction (interactive, auto-advance, no DCPM cost)
     #4  Shuffled Folding-In (fixed Session Bank, randomised K slots per step)
     #5  Full 10-step IR sequence (U + K1…K9); hierarchical bank selection
     #6  Accuracy guardrail on Mastery Checks (stop on wrong, 4-attempt limit)

   TODO: AUTH — Replace bootstrap block with Google OAuth / Clever callback.
         All game logic is isolated from identity; search "TODO: AUTH".
   TODO: Teacher Dashboard — studentData shape is stable; see data.js.
   TODO: Gamification — search "TODO: Gamification" for hook locations.
════════════════════════════════════════════════════════════════════════ */

'use strict';

/* ═══════════════════════════════════════════════════════
   STATE OBJECTS
════════════════════════════════════════════════════════ */

let studentData = null;

// Generic timed-test session (baseline / diagnostic / mastery-check / level-test)
const session = {
  facts:         [],   // problem card array for current test
  index:         0,    // current card position
  correctDigits: 0,    // running total (only for timed pass/fail scoring)
  timer:         null, // countdown controller
};

/* ── Diagnostic binary-search state ── */
const diagState = {
  searchLow:  'A',   // lower bound of remaining search space
  searchHigh: 'Z',   // upper bound
  round:      0,     // 1-based subtest counter (for UI label)
  lastTestEnd: null, // testEnd from the most recent subtest
};

/* ── IR practice state ── */
const irState = {
  levelKey:          '',
  factIndex:         0,     // index into LEVEL_MAP[levelKey].facts (non-rule-based)
  isRuleBased:       false, // true for Level A and F
  sessionBank:       [],    // 9-fact bank fixed for the current U1 cycle
  sequence:          [],    // pre-generated IR cards for current cycle
  seqIndex:          0,
  inErrorCorrection: false,
  errorExpectedAnswer: null,
  errorFactA:        null,  // for building error panel display
  errorFactB:        null,
};

/* ── Individual-fact mastery check state ── */
const masteryState = {
  attempts:    0,    // wrong-answer stops this session (reset on fresh IR entry)
  unknown:     null, // [a,b] for regular facts; null for rule-based
  isRuleBased: false,
  levelKey:    '',
};

/* ── End-of-level test state ── */
const levelTestState = {
  attempts: 0,
  levelKey: '',
};

/* ═══════════════════════════════════════════════════════
   BOOTSTRAP
════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
  // TODO: AUTH — swap with OAuth/Clever callback before launching auth
  studentData = loadStudentData();
  studentData.sessionStartMs = Date.now();
  saveStudentData(studentData);

  document.getElementById('btn-start').addEventListener('click', startBaseline);
  showScreen('screen-welcome');
});

/* ═══════════════════════════════════════════════════════
   BASELINE TEST  (2-minute, level-weighted across A-Z)
════════════════════════════════════════════════════════ */

function startBaseline() {
  session.facts         = buildBaselineFacts(); // level-weighted, 240 cards
  session.index         = 0;
  session.correctDigits = 0;

  const timerEl    = document.getElementById('baseline-timer');
  const progressEl = document.getElementById('baseline-progress');
  const scoreEl    = document.getElementById('baseline-score');
  const problemEl  = document.getElementById('baseline-problem');
  const inputEl    = document.getElementById('baseline-input');

  timerEl.textContent = '2:00';
  timerEl.classList.remove('urgent');
  scoreEl.textContent = '0 digits';
  showScreen('screen-baseline');
  renderProblem(problemEl, session.facts[0].display);
  focusInput(inputEl);

  session.timer = createCountdownTimer(120, timerEl, progressEl, null, (elapsed) => {
    finishBaseline(elapsed);
  });
  session.timer.start();

  attachInputHandler(inputEl, handleBaselineInput);
}

function handleBaselineInput(inputEl) {
  const card = session.facts[session.index];
  const typed = inputEl.value.trim();
  if (typed === '') return;

  const correctLen = String(card.answer).length;
  if (typed.length < correctLen) return; // wait for full answer

  scoreAndAdvanceSession(
    inputEl,
    document.getElementById('baseline-problem'),
    document.getElementById('baseline-score'),
    card,
    parseInt(typed, 10),
    () => { session.timer.stop(); finishBaseline(session.timer.getElapsed()); }
  );
}

function finishBaseline(elapsed) {
  removeInputHandler(document.getElementById('baseline-input'));
  // Guard against double-fire (timer expiry + exhausted facts)
  if (session._baselineDone) return;
  session._baselineDone = true;

  const dcpm = calculateDCPM(session.correctDigits, elapsed);
  recordDCPM(studentData, 'baseline', dcpm);

  if (dcpm >= 40) {
    showHighFluency(dcpm, () => {
      session._baselineDone = false;
      startBaseline();
    });
  } else {
    // Initialise diagnostic binary search over the full range [A, Z]
    diagState.searchLow   = 'A';
    diagState.searchHigh  = 'Z';
    diagState.round       = 0;
    diagState.lastTestEnd = null;
    session._baselineDone = false;
    showNextDiagIntro();
  }
}

/* ═══════════════════════════════════════════════════════
   DIAGNOSTIC MODE  (#1 — binary search, 1-min subtests)

   State machine:
     diagState.searchLow / searchHigh  = remaining search space
     Each subtest covers [searchLow, mid(searchLow, searchHigh)]
     Pass  → shrink search to [mid+1, searchHigh]
     Fail  → shrink search to [searchLow, mid]
     searchLow === searchHigh → done, place student
════════════════════════════════════════════════════════ */

function computeDiagTestRange() {
  const lowIdx  = LEVEL_ORDER.indexOf(diagState.searchLow);
  const highIdx = LEVEL_ORDER.indexOf(diagState.searchHigh);
  const midIdx  = Math.floor((lowIdx + highIdx) / 2);
  return {
    testStart: diagState.searchLow,
    testEnd:   LEVEL_ORDER[midIdx],
  };
}

function rangeLabelFor(start, end) {
  return start === end ? `Level ${start}` : `Levels ${start}–${end}`;
}

function showNextDiagIntro() {
  diagState.round++;
  const { testStart, testEnd } = computeDiagTestRange();
  const label = rangeLabelFor(testStart, testEnd);
  showDiagIntro(diagState.round, label, () => launchDiagSubtest(testStart, testEnd));
}

function launchDiagSubtest(testStart, testEnd) {
  session.facts         = buildDiagnosticFacts(testStart, testEnd); // level-weighted
  session.index         = 0;
  session.correctDigits = 0;
  diagState.lastTestEnd = testEnd;

  const timerEl    = document.getElementById('diag-timer');
  const progressEl = document.getElementById('diag-progress');
  const scoreEl    = document.getElementById('diag-score');
  const problemEl  = document.getElementById('diag-problem');
  const inputEl    = document.getElementById('diag-input');

  document.getElementById('diag-label').textContent =
    `Diagnostic · ${rangeLabelFor(testStart, testEnd)}`;
  timerEl.textContent = '1:00';
  timerEl.classList.remove('urgent');
  scoreEl.textContent = '0 digits';
  progressEl.style.width = '0%';

  showScreen('screen-diagnostic');
  renderProblem(problemEl, session.facts[0].display);
  focusInput(inputEl);

  session.timer = createCountdownTimer(60, timerEl, progressEl, null, (elapsed) => {
    finishDiagSubtest(elapsed);
  });
  session.timer.start();
  attachInputHandler(inputEl, handleDiagInput);
}

function handleDiagInput(inputEl) {
  const card = session.facts[session.index];
  const typed = inputEl.value.trim();
  if (typed === '') return;

  if (typed.length < String(card.answer).length) return;

  scoreAndAdvanceSession(
    inputEl,
    document.getElementById('diag-problem'),
    document.getElementById('diag-score'),
    card,
    parseInt(typed, 10),
    () => { session.timer.stop(); finishDiagSubtest(session.timer.getElapsed()); }
  );
}

function finishDiagSubtest(elapsed) {
  removeInputHandler(document.getElementById('diag-input'));

  const dcpm   = calculateDCPM(session.correctDigits, elapsed);
  const passed = dcpm >= 40;

  studentData.diagnosticHistory.push({
    date:       new Date().toISOString(),
    rangeStart: diagState.searchLow,
    rangeEnd:   diagState.lastTestEnd,
    dcpm:       Math.round(dcpm * 10) / 10,
  });
  recordDCPM(studentData, 'diagnostic', dcpm);

  // Update binary search bounds
  const lowIdx     = LEVEL_ORDER.indexOf(diagState.searchLow);
  const highIdx    = LEVEL_ORDER.indexOf(diagState.searchHigh);
  const testEndIdx = LEVEL_ORDER.indexOf(diagState.lastTestEnd);

  if (lowIdx === highIdx) {
    // Tested a single level → done
    const level = passed ? null : diagState.searchLow;
    placeDiagnosticResult(level);
    return;
  }

  if (passed) {
    const newLowIdx = testEndIdx + 1;
    if (newLowIdx > highIdx) {
      // Passed the entire search range → no gap found (edge case)
      placeDiagnosticResult(null);
      return;
    }
    diagState.searchLow  = LEVEL_ORDER[newLowIdx];
    diagState.searchHigh = diagState.searchHigh; // unchanged
  } else {
    // Gap is in [searchLow, testEnd]
    diagState.searchLow  = diagState.searchLow;  // unchanged
    diagState.searchHigh = diagState.lastTestEnd;
  }

  // More searching needed
  showNextDiagIntro();
}

function placeDiagnosticResult(level) {
  // level === null means passed everything (highly unlikely given baseline fail)
  const placedAt = level || 'A';
  studentData.currentLevel     = placedAt;
  studentData.currentFactIndex = 0;
  saveStudentData(studentData);

  showMessage(
    `Great effort! We'll start your practice at Level ${placedAt}.`,
    () => startPracticeLevel(placedAt)
  );
}

/* ═══════════════════════════════════════════════════════
   PRACTICE — Incremental Rehearsal  (#2 #4 #5)
════════════════════════════════════════════════════════ */

function startPracticeLevel(levelKey) {
  irState.levelKey  = levelKey;
  irState.factIndex = studentData.currentFactIndex || 0;
  practiceNextFact();
}

function practiceNextFact() {
  const levelKey = irState.levelKey;
  const level    = LEVEL_MAP[levelKey];

  // Rule-based levels (A & F) are treated as a single learning target
  irState.isRuleBased = level.commutative;

  if (irState.isRuleBased) {
    startRuleBasedIR(levelKey);
  } else {
    startRegularIR(levelKey);
  }
}

/* ── Regular IR (one fact at a time) ── */
function startRegularIR(levelKey) {
  const facts = LEVEL_MAP[levelKey].facts;

  if (irState.factIndex >= facts.length) {
    // All facts done → end-of-level test
    runLevelTest(levelKey);
    return;
  }

  const unknown = facts[irState.factIndex];

  // Build session bank (hierarchical, fixed for this U1 cycle)
  const masteredFacts = studentData.masteredFacts.map(k => parseFactKey(k));
  const priorInLevel  = facts.slice(0, irState.factIndex);
  const knownPool     = [...masteredFacts, ...priorInLevel];
  irState.sessionBank = buildSessionBank(unknown, knownPool, levelKey);

  // Generate sequence (randomised K slots from fixed bank)
  irState.sequence = generateIRSequence(unknown, irState.sessionBank);
  irState.seqIndex = 0;

  showPracticeScreen(levelKey, irState.factIndex + 1, facts.length);
  displayIRCard();
}

/* ── Rule-based IR (Level A, F: whole family as one cycle) ── */
function startRuleBasedIR(levelKey) {
  const masteredFacts = studentData.masteredFacts.map(k => parseFactKey(k));
  // Use first fact of level as reference for bank tier-selection
  const refFact = LEVEL_MAP[levelKey].facts[0];
  irState.sessionBank  = buildSessionBank(refFact, masteredFacts, levelKey);
  irState.sequence     = generateRuleBasedIRSequence(levelKey, irState.sessionBank);
  irState.seqIndex     = 0;

  showPracticeScreen(levelKey, null, null);
  displayIRCard();
}

function showPracticeScreen(levelKey, factNum, totalFacts) {
  const label = factNum !== null
    ? `Level ${levelKey} – Fact ${factNum}/${totalFacts}`
    : `Level ${levelKey} – Practice`;
  document.getElementById('practice-level-label').textContent = label;
  document.getElementById('practice-timer').textContent       = '';
  document.getElementById('practice-fact-progress').textContent =
    `Step 1/${irState.sequence.length}`;
  document.getElementById('practice-progress').style.width = '0%';

  showScreen('screen-practice');
  hideErrorPanel();
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
  if (irState.inErrorCorrection) return;

  const card  = irState.sequence[irState.seqIndex];
  const typed = inputEl.value.trim();
  if (typed === '') return;

  const correctLen = String(card.answer).length;
  if (typed.length < correctLen) return;

  const typedNum  = parseInt(typed, 10);
  const isCorrect = typedNum === card.answer;
  flashInput(inputEl, isCorrect);

  if (!isCorrect) {
    // #3 — DI error correction: show panel, require correct retype, restart sequence
    irState.inErrorCorrection   = true;
    irState.errorExpectedAnswer = card.answer;
    irState.errorFactA          = card.fact ? card.fact[0] : null;
    irState.errorFactB          = card.fact ? card.fact[1] : null;

    if (card.fact) {
      showErrorPanel(card.fact[0], card.fact[1], card.answer);
    } else {
      // addition/subtraction filler card — show generic error panel
      showErrorPanel('?', '?', card.answer);
    }
    attachErrorCorrectionHandler();
    return;
  }

  // Correct — advance
  irState.seqIndex++;
  if (irState.seqIndex >= irState.sequence.length) {
    // Full IR cycle complete → mastery check
    irSequenceComplete();
    return;
  }
  displayIRCard();
}

function irSequenceComplete() {
  if (irState.isRuleBased) {
    // Rule-based: whole level is the "unknown"
    masteryState.unknown     = null;
    masteryState.isRuleBased = true;
    masteryState.levelKey    = irState.levelKey;
    masteryState.attempts    = 0;
    runMasteryCheck(true /* freshEntry */);
  } else {
    const unknown = LEVEL_MAP[irState.levelKey].facts[irState.factIndex];
    masteryState.unknown     = unknown;
    masteryState.isRuleBased = false;
    masteryState.levelKey    = irState.levelKey;
    masteryState.attempts    = 0;
    runMasteryCheck(true /* freshEntry */);
  }
}

/* ── Error Correction Handler  (#3) ── */
function attachErrorCorrectionHandler() {
  const errorInput = document.getElementById('error-input');
  errorInput.value = '';
  errorInput.focus({ preventScroll: true });

  attachInputHandler(errorInput, (el) => {
    const typed = el.value.trim();
    if (typed === '') return;
    if (typed.length < String(irState.errorExpectedAnswer).length) return;

    const typedNum = parseInt(typed, 10);
    if (typedNum === irState.errorExpectedAnswer) {
      // Correct retype → restart IR cycle with same Session Bank (#4 reset logic)
      irState.inErrorCorrection = false;
      hideErrorPanel();
      removeInputHandler(errorInput);

      // Regenerate sequence from same bank (new random K-slot draws)
      if (irState.isRuleBased) {
        irState.sequence = generateRuleBasedIRSequence(irState.levelKey, irState.sessionBank);
      } else {
        const unknown    = LEVEL_MAP[irState.levelKey].facts[irState.factIndex];
        irState.sequence = generateIRSequence(unknown, irState.sessionBank);
      }
      irState.seqIndex = 0;
      displayIRCard();
    } else {
      // Still wrong → clear and let them try again (auto-advance will re-fire)
      el.value = '';
      el.focus({ preventScroll: true });
    }
  });
}

/* ═══════════════════════════════════════════════════════
   MASTERY CHECK  (#6 — accuracy guardrail + retry system)

   freshEntry = true  → reset masteryState.attempts to 0
   freshEntry = false → keep existing attempts counter (restart after wrong answer)
════════════════════════════════════════════════════════ */

function runMasteryCheck(freshEntry) {
  if (freshEntry) masteryState.attempts = 0;

  let checkFacts;
  if (masteryState.isRuleBased) {
    const allMastered = studentData.masteredFacts.map(k => parseFactKey(k));
    checkFacts = buildRuleBasedMasteryCheckSequence(masteryState.levelKey, allMastered);
    document.getElementById('mastery-check-label').textContent =
      `Mastery Check – Level ${masteryState.levelKey}`;
  } else {
    const allMastered = studentData.masteredFacts.map(k => parseFactKey(k));
    checkFacts = buildMasteryCheckSequence(masteryState.unknown, allMastered);
    const u = masteryState.unknown;
    document.getElementById('mastery-check-label').textContent =
      `Let's see if you know ${u[0]} × ${u[1]}!`;
  }

  session.facts         = checkFacts;
  session.index         = 0;
  session.correctDigits = 0;

  const timerEl    = document.getElementById('mastery-timer');
  const progressEl = document.getElementById('mastery-progress');
  const scoreEl    = document.getElementById('mastery-score');
  const problemEl  = document.getElementById('mastery-problem');
  const inputEl    = document.getElementById('mastery-input');

  timerEl.textContent = '1:00';
  timerEl.classList.remove('urgent');
  scoreEl.textContent = '0 digits';
  progressEl.style.width = '0%';
  showScreen('screen-mastery-check');
  renderProblem(problemEl, checkFacts[0].display);
  focusInput(inputEl);

  session.timer = createCountdownTimer(60, timerEl, progressEl, null, (elapsed) => {
    finishMasteryCheck(elapsed);
  });
  session.timer.start();

  attachInputHandler(inputEl, handleMasteryInput);
}

function handleMasteryInput(inputEl) {
  const card = session.facts[session.index];
  const typed = inputEl.value.trim();
  if (typed === '') return;

  const correctLen = String(card.answer).length;
  if (typed.length < correctLen) return;

  const typedNum  = parseInt(typed, 10);
  const isCorrect = typedNum === card.answer;

  if (!isCorrect) {
    // #6 — wrong answer: stop test immediately
    session.timer.stop();
    removeInputHandler(inputEl);
    flashInput(inputEl, false);
    handleMasteryWrongAnswer();
    return;
  }

  // Correct
  session.correctDigits += countCorrectDigits(card.answer, typedNum);
  flashInput(inputEl, true);
  session.index++;

  if (session.index >= session.facts.length) {
    session.timer.stop();
    finishMasteryCheck(session.timer.getElapsed());
    return;
  }

  renderProblem(document.getElementById('mastery-problem'), session.facts[session.index].display);
  focusInput(inputEl);
}

function handleMasteryWrongAnswer() {
  masteryState.attempts++;

  if (masteryState.attempts >= 4) {
    // 4th wrong answer → redirect to IR
    showMessage(
      "Let's practice a little more to get faster. You've got this!",
      () => {
        irState.seqIndex = 0;
        practiceNextFact(); // re-starts IR for the same fact/level
      }
    );
  } else {
    const left = 4 - masteryState.attempts;
    showMessage(
      `Oops! You got one wrong. No big deal. Try again. You have ${left} chance${left === 1 ? '' : 's'} left.`,
      () => runMasteryCheck(false) // keep same attempts count
    );
  }
}

function finishMasteryCheck(elapsed) {
  removeInputHandler(document.getElementById('mastery-input'));
  // 100% accuracy reached (zero wrong answers stopped the test)
  const dcpm = calculateDCPM(session.correctDigits, elapsed);
  recordDCPM(studentData, 'mastery-check', dcpm);

  if (dcpm >= 40) {
    // Full pass → mark fact/level mastered
    masteryCheckPass(dcpm);
  } else {
    // Accurate but too slow → encourage speed, restart mastery check
    // (does NOT increment masteryState.attempts)
    showMessage(
      "You're doing great on accuracy! Let's try one more time to get your speed up.",
      () => runMasteryCheck(false)
    );
  }
}

function masteryCheckPass(dcpm) {
  if (masteryState.isRuleBased) {
    // Mark ALL facts in the level as mastered
    const levelKey = masteryState.levelKey;
    for (const fact of LEVEL_MAP[levelKey].facts) {
      const key = factKey(fact);
      if (!studentData.masteredFacts.includes(key)) {
        studentData.masteredFacts.push(key);
      }
    }
    if (!studentData.masteredLevels.includes(levelKey)) {
      studentData.masteredLevels.push(levelKey);
    }
    saveStudentData(studentData);

    // Advance to next level
    const nextIdx   = LEVEL_ORDER.indexOf(levelKey) + 1;
    const nextLevel = nextIdx < LEVEL_ORDER.length ? LEVEL_ORDER[nextIdx] : null;
    studentData.currentLevel     = nextLevel || levelKey;
    studentData.currentFactIndex = 0;
    saveStudentData(studentData);

    // TODO: Gamification hook — fire mastery event
    showMessage(
      `Excellent! You've mastered the ${levelKey === 'A' ? 'ones' : 'zeros'} rule!`,
      () => {
        if (nextLevel) {
          startPracticeLevel(nextLevel);
        } else {
          showScreen('screen-welcome');
        }
      }
    );
  } else {
    // Mark single fact mastered
    const unknown = masteryState.unknown;
    const key     = factKey(unknown);
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
  }
}

/* ═══════════════════════════════════════════════════════
   LEVEL TEST  (#6 — accuracy guardrail applies here too)
════════════════════════════════════════════════════════ */

function runLevelTest(levelKey) {
  levelTestState.levelKey  = levelKey;
  levelTestState.attempts  = 0;
  launchLevelTest(levelKey);
}

function launchLevelTest(levelKey) {
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
  progressEl.style.width = '0%';
  showScreen('screen-level-test');
  renderProblem(problemEl, testFacts[0].display);
  focusInput(inputEl);

  session.timer = createCountdownTimer(60, timerEl, progressEl, null, (elapsed) => {
    finishLevelTest(elapsed);
  });
  session.timer.start();
  attachInputHandler(inputEl, handleLevelTestInput);
}

function handleLevelTestInput(inputEl) {
  const card = session.facts[session.index];
  const typed = inputEl.value.trim();
  if (typed === '') return;

  if (typed.length < String(card.answer).length) return;

  const typedNum  = parseInt(typed, 10);
  const isCorrect = typedNum === card.answer;

  if (!isCorrect) {
    // #6 — stop on wrong answer
    session.timer.stop();
    removeInputHandler(inputEl);
    flashInput(inputEl, false);
    handleLevelTestWrongAnswer();
    return;
  }

  session.correctDigits += countCorrectDigits(card.answer, typedNum);
  flashInput(inputEl, true);
  session.index++;

  if (session.index >= session.facts.length) {
    session.timer.stop();
    finishLevelTest(session.timer.getElapsed());
    return;
  }

  renderProblem(document.getElementById('level-test-problem'), session.facts[session.index].display);
  focusInput(inputEl);
}

function handleLevelTestWrongAnswer() {
  levelTestState.attempts++;

  if (levelTestState.attempts >= 4) {
    showMessage(
      "Let's practice a little more to get faster. You've got this!",
      () => {
        irState.factIndex = 0;
        studentData.currentFactIndex = 0;
        saveStudentData(studentData);
        startPracticeLevel(levelTestState.levelKey);
      }
    );
  } else {
    const left = 4 - levelTestState.attempts;
    showMessage(
      `Oops! You got one wrong. No big deal. Try again. You have ${left} chance${left === 1 ? '' : 's'} left.`,
      () => launchLevelTest(levelTestState.levelKey) // restart test, keep attempts
    );
  }
}

function finishLevelTest(elapsed) {
  removeInputHandler(document.getElementById('level-test-input'));
  const dcpm   = calculateDCPM(session.correctDigits, elapsed);
  const passed = dcpm >= 40;
  recordDCPM(studentData, 'level-test', dcpm);

  if (passed) {
    advanceToNextLevel(levelTestState.levelKey, dcpm);
  } else {
    // 100% accuracy but too slow
    showMessage(
      "You're doing great on accuracy! Let's try one more time to get your speed up.",
      () => launchLevelTest(levelTestState.levelKey)
    );
  }
}

function advanceToNextLevel(completedLevel, dcpm) {
  if (!studentData.masteredLevels.includes(completedLevel)) {
    studentData.masteredLevels.push(completedLevel);
  }

  const nextIdx   = LEVEL_ORDER.indexOf(completedLevel) + 1;
  const nextLevel = nextIdx < LEVEL_ORDER.length ? LEVEL_ORDER[nextIdx] : null;

  studentData.currentLevel     = nextLevel || completedLevel;
  studentData.currentFactIndex = 0;
  saveStudentData(studentData);

  // TODO: Gamification hook — fire 'levelMastered' CustomEvent
  // document.dispatchEvent(new CustomEvent('levelMastered', { detail: { completedLevel, dcpm } }));

  if (nextLevel) {
    showLevelComplete(
      `Level ${completedLevel} Complete!`,
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
}

/* ═══════════════════════════════════════════════════════
   SHARED SESSION HELPER
   Scores a card, updates display, advances index.
════════════════════════════════════════════════════════ */

function scoreAndAdvanceSession(inputEl, problemEl, scoreEl, card, typedNum, onExhausted) {
  const digits = countCorrectDigits(card.answer, typedNum);
  session.correctDigits += digits;
  updateScoreDisplay(scoreEl, session.correctDigits);
  flashInput(inputEl, typedNum === card.answer);

  session.index++;
  if (session.index >= session.facts.length) {
    onExhausted();
    return;
  }
  renderProblem(problemEl, session.facts[session.index].display);
  focusInput(inputEl);
}

/* ═══════════════════════════════════════════════════════
   INPUT HANDLER MANAGEMENT

   Each input element gets exactly one 'input' listener and one 'keydown'
   listener stored on the element itself to allow safe replacement.
════════════════════════════════════════════════════════ */

function attachInputHandler(inputEl, handler) {
  removeInputHandler(inputEl);

  const onInput   = () => handler(inputEl);
  const onKeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const typed = inputEl.value.trim();
      if (typed !== '') forceEvaluate(inputEl, typed);
    }
  };

  inputEl._mfInputHandler   = onInput;
  inputEl._mfKeydownHandler = onKeydown;
  inputEl.addEventListener('input',   onInput);
  inputEl.addEventListener('keydown', onKeydown);
}

function removeInputHandler(inputEl) {
  if (!inputEl) return;
  if (inputEl._mfInputHandler)   inputEl.removeEventListener('input',   inputEl._mfInputHandler);
  if (inputEl._mfKeydownHandler) inputEl.removeEventListener('keydown', inputEl._mfKeydownHandler);
  inputEl._mfInputHandler   = null;
  inputEl._mfKeydownHandler = null;
}

/* ─────────────────────────────────────────────
   FORCE EVALUATE  (Enter key handler)
   Evaluates whatever is typed regardless of digit length.
   A short/wrong answer scores 0 correct digits and is treated as incorrect
   for accuracy-guardrail screens.
───────────────────────────────────────────── */
function forceEvaluate(inputEl, typed) {
  const activeScreen = document.querySelector('.screen.active');
  if (!activeScreen) return;
  const screenId = activeScreen.id;
  const typedNum = parseInt(typed, 10);

  if (screenId === 'screen-baseline') {
    if (session.index >= session.facts.length) return;
    scoreAndAdvanceSession(
      inputEl,
      document.getElementById('baseline-problem'),
      document.getElementById('baseline-score'),
      session.facts[session.index],
      typedNum,
      () => { session.timer.stop(); finishBaseline(session.timer.getElapsed()); }
    );

  } else if (screenId === 'screen-diagnostic') {
    if (session.index >= session.facts.length) return;
    scoreAndAdvanceSession(
      inputEl,
      document.getElementById('diag-problem'),
      document.getElementById('diag-score'),
      session.facts[session.index],
      typedNum,
      () => { session.timer.stop(); finishDiagSubtest(session.timer.getElapsed()); }
    );

  } else if (screenId === 'screen-practice') {
    if (irState.inErrorCorrection) {
      // Delegate to error-correction handler via fake input event
      const errorInput = document.getElementById('error-input');
      if (document.activeElement === errorInput && errorInput.value.trim() !== '') {
        attachErrorCorrectionHandler(); // re-triggers via current value
      }
      return;
    }
    if (irState.seqIndex >= irState.sequence.length) return;
    const card      = irState.sequence[irState.seqIndex];
    const isCorrect = typedNum === card.answer;
    flashInput(inputEl, isCorrect);

    if (!isCorrect) {
      irState.inErrorCorrection   = true;
      irState.errorExpectedAnswer = card.answer;
      if (card.fact) {
        showErrorPanel(card.fact[0], card.fact[1], card.answer);
      } else {
        showErrorPanel('?', '?', card.answer);
      }
      attachErrorCorrectionHandler();
    } else {
      irState.seqIndex++;
      if (irState.seqIndex >= irState.sequence.length) {
        irSequenceComplete();
      } else {
        displayIRCard();
      }
    }

  } else if (screenId === 'screen-mastery-check') {
    if (session.index >= session.facts.length) return;
    const card      = session.facts[session.index];
    const isCorrect = typedNum === card.answer;
    if (!isCorrect) {
      session.timer.stop();
      removeInputHandler(inputEl);
      flashInput(inputEl, false);
      handleMasteryWrongAnswer();
    } else {
      session.correctDigits += countCorrectDigits(card.answer, typedNum);
      flashInput(inputEl, true);
      session.index++;
      if (session.index >= session.facts.length) {
        session.timer.stop();
        finishMasteryCheck(session.timer.getElapsed());
      } else {
        renderProblem(document.getElementById('mastery-problem'), session.facts[session.index].display);
        focusInput(inputEl);
      }
    }

  } else if (screenId === 'screen-level-test') {
    if (session.index >= session.facts.length) return;
    const card      = session.facts[session.index];
    const isCorrect = typedNum === card.answer;
    if (!isCorrect) {
      session.timer.stop();
      removeInputHandler(inputEl);
      flashInput(inputEl, false);
      handleLevelTestWrongAnswer();
    } else {
      session.correctDigits += countCorrectDigits(card.answer, typedNum);
      flashInput(inputEl, true);
      session.index++;
      if (session.index >= session.facts.length) {
        session.timer.stop();
        finishLevelTest(session.timer.getElapsed());
      } else {
        renderProblem(document.getElementById('level-test-problem'), session.facts[session.index].display);
        focusInput(inputEl);
      }
    }
  }
}
