/* ═══════════════════════════════════════════════════════════════════════
   app.js — Main application controller.

   Flow:
     Welcome → Baseline (3 min, 4×45s segments) → High Fluency | Placement
     → Practice (IR) → Mastery Check → Fact Progress → Level Test
     → New Level Welcome → next level

   Updates implemented:
     #1  4-tier IR hierarchy + 55-card hard-coded sequence
     #2  No-back-to-back repeats for Known cards
     #3  3-minute segmented baseline (replaces binary-search diagnostic)
     #4  80/20 mastery check maintenance distribution
     #5  Remove digits counter from timed screens
     #6  Visual echo feedback on auto-submit
     #7  Snap-zoom 3-2-1-GO! countdown before tests
     #8  Randomized praise bank (no consecutive repeats)
     #9  Fact Progress + New Level Welcome transition screens

   TODO: AUTH — Replace bootstrap block with Google OAuth / Clever callback.
   TODO: Teacher Dashboard — studentData shape is stable; see data.js.
   TODO: Gamification — search "TODO: Gamification" for hook locations.
════════════════════════════════════════════════════════════════════════ */

'use strict';

/* ═══════════════════════════════════════════════════════
   STATE OBJECTS
════════════════════════════════════════════════════════ */

let studentData = null;

// Generic timed-test session (baseline / mastery-check / level-test)
const session = {
  facts:         [],
  index:         0,
  correctDigits: 0,
  timer:         null,
};

/* ── Segmented Baseline state  (#3) ── */
const baselineState = {
  segIndex:       0,    // current segment index (0–3)
  segDcpmResults: [],   // DCPM per completed segment
  segStartDigits: 0,    // correctDigits at start of current segment
  segStartTime:   0,    // elapsed seconds at start of current segment
  decks:          [],   // 4 shuffled fact decks, one per segment
  deckIdx:        0,    // index into current deck
};

/* ── IR practice state ── */
const irState = {
  levelKey:          '',
  factIndex:         0,
  isRuleBased:       false,
  sessionBank:       [],
  sequence:          [],
  seqIndex:          0,
  inErrorCorrection: false,
  errorExpectedAnswer: null,
  errorFactA:        null,
  errorFactB:        null,
};

/* ── Individual-fact mastery check state ── */
const masteryState = {
  attempts:    0,
  unknown:     null,
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
   BASELINE TEST  (#3 — 3-minute, 4×45s segments A-G / H-N / O-U / V-Z)
════════════════════════════════════════════════════════ */

function startBaseline() {
  // Build one shuffle-and-deplete deck per segment
  baselineState.segIndex       = 0;
  baselineState.segDcpmResults = [];
  baselineState.segStartDigits = 0;
  baselineState.segStartTime   = 0;
  baselineState.decks          = BASELINE_SEGMENTS.map(s => buildSegmentDeck(s.levels));
  baselineState.deckIdx        = 0;

  session.correctDigits = 0;
  session._baselineDone = false;

  showCountdown(() => launchBaselineTimer());
}

function launchBaselineTimer() {
  const timerEl    = document.getElementById('baseline-timer');
  const progressEl = document.getElementById('baseline-progress');
  const labelEl    = document.getElementById('baseline-section-label');
  const problemEl  = document.getElementById('baseline-problem');
  const inputEl    = document.getElementById('baseline-input');

  timerEl.textContent = '3:00';
  timerEl.classList.remove('urgent');
  labelEl.textContent = 'Section 1 / 4';
  showScreen('screen-baseline');

  // Load first card from segment 0 deck
  const firstCard = currentBaselineCard();
  renderProblem(problemEl, firstCard.display);
  focusInput(inputEl);

  session.timer = createCountdownTimer(
    BASELINE_TOTAL_SEC,
    timerEl,
    progressEl,
    (elapsed, remaining) => onBaselineTick(elapsed, remaining, labelEl),
    (elapsed) => finishBaseline(elapsed)
  );
  session.timer.start();

  attachInputHandler(inputEl, handleBaselineInput);
}

function onBaselineTick(elapsed, remaining, labelEl) {
  // Detect segment boundary crossings at 45, 90, 135 seconds
  const newSegIdx = Math.min(
    Math.floor(elapsed / BASELINE_SEGMENT_SEC),
    BASELINE_SEGMENTS.length - 1
  );

  if (newSegIdx !== baselineState.segIndex) {
    // Record DCPM for the completed segment
    const segElapsed = elapsed - baselineState.segStartTime;
    const segDigits  = session.correctDigits - baselineState.segStartDigits;
    const segDcpm    = calculateDCPM(segDigits, segElapsed);
    baselineState.segDcpmResults.push(segDcpm);

    // Advance to next segment
    baselineState.segIndex       = newSegIdx;
    baselineState.segStartDigits = session.correctDigits;
    baselineState.segStartTime   = elapsed;
    baselineState.deckIdx        = 0;

    labelEl.textContent = `Section ${newSegIdx + 1} / 4`;
  }
}

function currentBaselineCard() {
  const deck = baselineState.decks[baselineState.segIndex];
  if (!deck || deck.length === 0) return { display: '0 × 0', answer: 0 };
  const idx = baselineState.deckIdx % deck.length;
  return deck[idx];
}

function advanceBaselineCard(problemEl) {
  baselineState.deckIdx++;
  const card = currentBaselineCard();
  renderProblem(problemEl, card.display);
}

function handleBaselineInput(inputEl) {
  const card  = currentBaselineCard();
  const typed = inputEl.value.trim();
  if (typed === '') return;

  if (typed.length < String(card.answer).length) return;

  const typedNum  = parseInt(typed, 10);
  const isCorrect = typedNum === card.answer;
  const digits    = countCorrectDigits(card.answer, typedNum);

  session.correctDigits += digits;
  flashInput(inputEl, isCorrect);
  showAnswerEcho(inputEl, typed, isCorrect);

  const problemEl = document.getElementById('baseline-problem');
  advanceBaselineCard(problemEl);
  focusInput(inputEl);
}

function finishBaseline(elapsed) {
  removeInputHandler(document.getElementById('baseline-input'));
  if (session._baselineDone) return;
  session._baselineDone = true;

  // Record final segment DCPM
  const finalSegElapsed = elapsed - baselineState.segStartTime;
  const finalSegDigits  = session.correctDigits - baselineState.segStartDigits;
  baselineState.segDcpmResults.push(calculateDCPM(finalSegDigits, finalSegElapsed));

  // Fill any missing segments (if test ended before crossing all boundaries)
  while (baselineState.segDcpmResults.length < BASELINE_SEGMENTS.length) {
    baselineState.segDcpmResults.push(0);
  }

  const overallDcpm = calculateDCPM(session.correctDigits, elapsed);
  recordDCPM(studentData, 'baseline', overallDcpm);

  if (overallDcpm >= 40) {
    showHighFluency(overallDcpm, () => {
      session._baselineDone = false;
      startBaseline();
    });
    return;
  }

  // Find first failing segment → place student at that segment's startLevel
  let placedLevel = 'A';
  for (let i = 0; i < BASELINE_SEGMENTS.length; i++) {
    if (baselineState.segDcpmResults[i] < 40) {
      placedLevel = BASELINE_SEGMENTS[i].startLevel;
      break;
    }
    // If all segments pass, shouldn't reach here (covered by overallDcpm >= 40 above)
    placedLevel = BASELINE_SEGMENTS[BASELINE_SEGMENTS.length - 1].startLevel;
  }

  studentData.currentLevel     = placedLevel;
  studentData.currentFactIndex = 0;
  saveStudentData(studentData);

  showMessage(
    `Great effort! We'll start your practice at Level ${placedLevel}.`,
    () => startPracticeLevel(placedLevel)
  );
}

/* ═══════════════════════════════════════════════════════
   PRACTICE — Incremental Rehearsal  (#1 #2)
════════════════════════════════════════════════════════ */

function startPracticeLevel(levelKey) {
  irState.levelKey  = levelKey;
  irState.factIndex = studentData.currentFactIndex || 0;
  practiceNextFact();
}

function practiceNextFact() {
  const levelKey = irState.levelKey;
  const level    = LEVEL_MAP[levelKey];

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
    runLevelTest(levelKey);
    return;
  }

  const unknown = facts[irState.factIndex];

  const masteredFacts = studentData.masteredFacts.map(k => parseFactKey(k));
  const priorInLevel  = facts.slice(0, irState.factIndex);
  const knownPool     = [...masteredFacts, ...priorInLevel];
  irState.sessionBank = buildSessionBank(unknown, knownPool, levelKey);

  irState.sequence = generateIRSequence(unknown, irState.sessionBank);
  irState.seqIndex = 0;

  showCountdown(() => {
    showPracticeScreen(levelKey, irState.factIndex + 1, facts.length);
    displayIRCard();
  });
}

/* ── Rule-based IR (Level A, F: whole family as one cycle) ── */
function startRuleBasedIR(levelKey) {
  const masteredFacts = studentData.masteredFacts.map(k => parseFactKey(k));
  const refFact = LEVEL_MAP[levelKey].facts[0];
  irState.sessionBank  = buildSessionBank(refFact, masteredFacts, levelKey);
  irState.sequence     = generateRuleBasedIRSequence(levelKey, irState.sessionBank);
  irState.seqIndex     = 0;

  showCountdown(() => {
    showPracticeScreen(levelKey, null, null);
    displayIRCard();
  });
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
  showAnswerEcho(inputEl, typed, isCorrect);

  if (!isCorrect) {
    irState.inErrorCorrection   = true;
    irState.errorExpectedAnswer = card.answer;
    irState.errorFactA          = card.fact ? card.fact[0] : null;
    irState.errorFactB          = card.fact ? card.fact[1] : null;

    if (card.fact) {
      showErrorPanel(card.fact[0], card.fact[1], card.answer);
    } else {
      showErrorPanel('?', '?', card.answer);
    }
    attachErrorCorrectionHandler();
    return;
  }

  irState.seqIndex++;
  if (irState.seqIndex >= irState.sequence.length) {
    irSequenceComplete();
    return;
  }
  displayIRCard();
}

function irSequenceComplete() {
  if (irState.isRuleBased) {
    masteryState.unknown     = null;
    masteryState.isRuleBased = true;
    masteryState.levelKey    = irState.levelKey;
    masteryState.attempts    = 0;
    runMasteryCheck(true);
  } else {
    const unknown = LEVEL_MAP[irState.levelKey].facts[irState.factIndex];
    masteryState.unknown     = unknown;
    masteryState.isRuleBased = false;
    masteryState.levelKey    = irState.levelKey;
    masteryState.attempts    = 0;
    runMasteryCheck(true);
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
      irState.inErrorCorrection = false;
      hideErrorPanel();
      removeInputHandler(errorInput);

      if (irState.isRuleBased) {
        irState.sequence = generateRuleBasedIRSequence(irState.levelKey, irState.sessionBank);
      } else {
        const unknown    = LEVEL_MAP[irState.levelKey].facts[irState.factIndex];
        irState.sequence = generateIRSequence(unknown, irState.sessionBank);
      }
      irState.seqIndex = 0;
      displayIRCard();
    } else {
      el.value = '';
      el.focus({ preventScroll: true });
    }
  });
}

/* ═══════════════════════════════════════════════════════
   MASTERY CHECK  (#4 — 80/20 maintenance + accuracy guardrail)

   freshEntry = true  → reset masteryState.attempts to 0
   freshEntry = false → keep existing attempts counter
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
  const problemEl  = document.getElementById('mastery-problem');
  const inputEl    = document.getElementById('mastery-input');

  timerEl.textContent = '1:00';
  timerEl.classList.remove('urgent');
  progressEl.style.width = '0%';

  showCountdown(() => {
    showScreen('screen-mastery-check');
    renderProblem(problemEl, checkFacts[0].display);
    focusInput(inputEl);

    session.timer = createCountdownTimer(60, timerEl, progressEl, null, (elapsed) => {
      finishMasteryCheck(elapsed);
    });
    session.timer.start();

    attachInputHandler(inputEl, handleMasteryInput);
  });
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
    session.timer.stop();
    removeInputHandler(inputEl);
    flashInput(inputEl, false);
    showAnswerEcho(inputEl, typed, false);
    handleMasteryWrongAnswer();
    return;
  }

  session.correctDigits += countCorrectDigits(card.answer, typedNum);
  flashInput(inputEl, true);
  showAnswerEcho(inputEl, typed, true);
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
    showMessage(
      "Let's practice a little more to get faster. You've got this!",
      () => {
        irState.seqIndex = 0;
        practiceNextFact();
      }
    );
  } else {
    const left = 4 - masteryState.attempts;
    showMessage(
      `Oops! You got one wrong. No big deal. Try again. You have ${left} chance${left === 1 ? '' : 's'} left.`,
      () => runMasteryCheck(false)
    );
  }
}

function finishMasteryCheck(elapsed) {
  removeInputHandler(document.getElementById('mastery-input'));
  const dcpm = calculateDCPM(session.correctDigits, elapsed);
  recordDCPM(studentData, 'mastery-check', dcpm);

  if (dcpm >= 40) {
    masteryCheckPass(dcpm);
  } else {
    showMessage(
      "You're doing great on accuracy! Let's try one more time to get your speed up.",
      () => runMasteryCheck(false)
    );
  }
}

function masteryCheckPass(dcpm) {
  const praise = getRandomPraise();

  if (masteryState.isRuleBased) {
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

    const nextIdx   = LEVEL_ORDER.indexOf(levelKey) + 1;
    const nextLevel = nextIdx < LEVEL_ORDER.length ? LEVEL_ORDER[nextIdx] : null;
    studentData.currentLevel     = nextLevel || levelKey;
    studentData.currentFactIndex = 0;
    saveStudentData(studentData);

    if (nextLevel) {
      const nextFact = LEVEL_MAP[nextLevel].facts[0] || null;
      showNewLevel(nextLevel, nextFact, praise, () => {
        showCountdown(() => startPracticeLevel(nextLevel));
      });
    } else {
      showLevelComplete(
        'All Levels Complete!',
        'You have mastered all multiplication facts. Show this to your teacher!',
        dcpm,
        () => showScreen('screen-welcome')
      );
    }
  } else {
    const unknown = masteryState.unknown;
    const key     = factKey(unknown);
    if (!studentData.masteredFacts.includes(key)) {
      studentData.masteredFacts.push(key);
    }
    saveStudentData(studentData);

    irState.factIndex++;
    studentData.currentFactIndex = irState.factIndex;
    saveStudentData(studentData);

    const levelKey   = masteryState.levelKey;
    const facts      = LEVEL_MAP[levelKey].facts;
    const totalFacts = facts.length;
    const nextFact   = irState.factIndex < totalFacts ? facts[irState.factIndex] : null;

    showFactProgress(levelKey, irState.factIndex, totalFacts, nextFact, praise, () => {
      showCountdown(() => practiceNextFact());
    });
  }
}

/* ═══════════════════════════════════════════════════════
   LEVEL TEST  (#6 — accuracy guardrail)
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
  const problemEl  = document.getElementById('level-test-problem');
  const inputEl    = document.getElementById('level-test-input');

  document.getElementById('level-test-label').textContent = `Level ${levelKey} Test`;
  timerEl.textContent = '1:00';
  timerEl.classList.remove('urgent');
  progressEl.style.width = '0%';

  showCountdown(() => {
    showScreen('screen-level-test');
    renderProblem(problemEl, testFacts[0].display);
    focusInput(inputEl);

    session.timer = createCountdownTimer(60, timerEl, progressEl, null, (elapsed) => {
      finishLevelTest(elapsed);
    });
    session.timer.start();
    attachInputHandler(inputEl, handleLevelTestInput);
  });
}

function handleLevelTestInput(inputEl) {
  const card = session.facts[session.index];
  const typed = inputEl.value.trim();
  if (typed === '') return;

  if (typed.length < String(card.answer).length) return;

  const typedNum  = parseInt(typed, 10);
  const isCorrect = typedNum === card.answer;

  if (!isCorrect) {
    session.timer.stop();
    removeInputHandler(inputEl);
    flashInput(inputEl, false);
    showAnswerEcho(inputEl, typed, false);
    handleLevelTestWrongAnswer();
    return;
  }

  session.correctDigits += countCorrectDigits(card.answer, typedNum);
  flashInput(inputEl, true);
  showAnswerEcho(inputEl, typed, true);
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
      () => launchLevelTest(levelTestState.levelKey)
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

  // TODO: Gamification hook
  // document.dispatchEvent(new CustomEvent('levelMastered', { detail: { completedLevel, dcpm } }));

  if (nextLevel) {
    const praise   = getRandomPraise();
    const nextFact = LEVEL_MAP[nextLevel].facts[0] || null;
    showNewLevel(nextLevel, nextFact, praise, () => {
      showCountdown(() => startPracticeLevel(nextLevel));
    });
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
   INPUT HANDLER MANAGEMENT
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
───────────────────────────────────────────── */
function forceEvaluate(inputEl, typed) {
  const activeScreen = document.querySelector('.screen.active');
  if (!activeScreen) return;
  const screenId = activeScreen.id;
  const typedNum = parseInt(typed, 10);

  if (screenId === 'screen-baseline') {
    const card      = currentBaselineCard();
    const isCorrect = typedNum === card.answer;
    const digits    = countCorrectDigits(card.answer, typedNum);
    session.correctDigits += digits;
    flashInput(inputEl, isCorrect);
    showAnswerEcho(inputEl, typed, isCorrect);
    advanceBaselineCard(document.getElementById('baseline-problem'));
    focusInput(inputEl);

  } else if (screenId === 'screen-practice') {
    if (irState.inErrorCorrection) {
      const errorInput = document.getElementById('error-input');
      if (document.activeElement === errorInput && errorInput.value.trim() !== '') {
        attachErrorCorrectionHandler();
      }
      return;
    }
    if (irState.seqIndex >= irState.sequence.length) return;
    const card      = irState.sequence[irState.seqIndex];
    const isCorrect = typedNum === card.answer;
    flashInput(inputEl, isCorrect);
    showAnswerEcho(inputEl, typed, isCorrect);

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
      showAnswerEcho(inputEl, typed, false);
      handleMasteryWrongAnswer();
    } else {
      session.correctDigits += countCorrectDigits(card.answer, typedNum);
      flashInput(inputEl, true);
      showAnswerEcho(inputEl, typed, true);
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
      showAnswerEcho(inputEl, typed, false);
      handleLevelTestWrongAnswer();
    } else {
      session.correctDigits += countCorrectDigits(card.answer, typedNum);
      flashInput(inputEl, true);
      showAnswerEcho(inputEl, typed, true);
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
