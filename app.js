/**
 * app.js
 * Main Application Coordinator — Multiplication Fluency System
 *
 * This module wires together the Engine layer and the UI layer.
 * It owns the top-level state machine and drives all phase transitions.
 *
 * ── Phase State Machine ───────────────────────────────────────────────────
 *
 *  WELCOME
 *    └─► BASELINE  (2-min randomised assessment — all facts)
 *          └─► PLACEMENT  (calculate DCPM → pick starting level)
 *                └─► PRACTICE  (IR cycles for current level)
 *                      └─► LEVEL_COMPLETE  (all targets mastered)
 *                              └─► LEVEL_TEST  (1-min timed test)
 *                                    ├─► PRACTICE  (if DCPM < 40 — retry)
 *                                    └─► PRACTICE  (next level, if DCPM ≥ 40)
 *                                          └─► COMPLETE  (all levels done)
 *
 * ── Engine / UI Separation ───────────────────────────────────────────────
 *   Engine.* modules are called here; UI.* modules update the DOM.
 *   No UI module calls Engine modules directly.
 *
 * ── FUTURE INTEGRATION NOTE ──────────────────────────────────────────────
 *   Firebase Auth: add sign-in flow before initApp().
 *   Cloud save: Engine.Mastery._load/_save already have comment markers.
 */

(function () {
  'use strict';

  // Shorthand aliases
  var Levels      = Engine.Levels;
  var DCPM        = Engine.DCPM;
  var IR          = Engine.IR;
  var Mastery     = Engine.Mastery;
  var Progression = Engine.Progression;
  var Display     = UI.Display;
  var Renderer    = UI.Renderer;
  var Timer       = UI.Timer;
  var Input       = UI.Input;

  // ── Runtime assessment state (NOT persisted — recomputed each session) ────
  var _assessment = {
    pool:        [],    // shuffled [a,b] pairs
    poolIndex:   0,     // current position in pool
    responses:   [],    // {a,b,correctAnswer,studentAnswer,correctDigits,responseMs}
    startTime:   null,  // performance.now() when first problem displayed
    problemTime: null,  // performance.now() when current problem was shown
    type:        ''     // 'BASELINE' | 'LEVEL_TEST'
  };

  // ── Runtime practice state ────────────────────────────────────────────────
  var _practice = {
    levelKey:    '',
    targets:     [],   // unmastered [a,b] target facts for this level
    targetIdx:   0     // index into targets[]
  };

  // ── DOM elements (populated after DOMContentLoaded) ───────────────────────
  var E;  // shorthand for Renderer.getAll()

  // ═════════════════════════════════════════════════════════════════════════
  // INITIALISATION
  // ═════════════════════════════════════════════════════════════════════════

  function initApp() {
    Renderer.init();
    E = Renderer.getAll();

    Mastery.init();

    // Wire keyboard input with teacher-reset callback
    Input.init(handleTeacherReset);

    // Wire button events
    E.btnStart.addEventListener('click', handleStartClicked);
    E.btnPlacementNext.addEventListener('click', handlePlacementNext);
    E.btnLevelTest.addEventListener('click', handleLevelTestClicked);
    E.btnTestResultNext.addEventListener('click', handleTestResultNext);
    E.adminReset.addEventListener('click', handleTeacherReset);

    // Restore or show welcome
    var savedPhase = Mastery.getPhase();
    if (savedPhase === 'WELCOME' || !savedPhase) {
      enterWelcome();
    } else {
      // Resume from where student left off
      resumeFromSavedState(savedPhase);
    }
  }

  // ── resumeFromSavedState ──────────────────────────────────────────────────
  function resumeFromSavedState(phase) {
    var level = Mastery.getCurrentLevel();
    Display.showResumeInfo(E.resumeInfo, level, phase);

    if (phase === 'BASELINE') {
      // Baseline was interrupted — restart it
      enterBaseline();
    } else if (phase === 'PRACTICE') {
      enterPractice(level);
    } else if (phase === 'LEVEL_TEST') {
      enterLevelTest(level);
    } else if (phase === 'COMPLETE') {
      enterComplete();
    } else {
      enterWelcome();
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // WELCOME PHASE
  // ═════════════════════════════════════════════════════════════════════════

  function enterWelcome() {
    Mastery.setPhase('WELCOME');
    Display.showScreen('screen-welcome');
  }

  function handleStartClicked() {
    enterBaseline();
  }

  // ═════════════════════════════════════════════════════════════════════════
  // PHASE 1: BASELINE ASSESSMENT (2 minutes)
  // ═════════════════════════════════════════════════════════════════════════

  function enterBaseline() {
    Mastery.setPhase('BASELINE');
    Display.showScreen('screen-assessment');
    Display.setPhaseLabel(E.assessPhaseLabel, 'BASELINE');
    Display.setLevelLabel(E.assessLevelLabel, 'All Levels');

    _assessment.pool      = Progression.buildAssessmentPool('BASELINE', null);
    _assessment.poolIndex = 0;
    _assessment.responses = [];
    _assessment.startTime = null;
    _assessment.type      = 'BASELINE';

    Display.setDCPM(E.assessDCPM, null);

    Timer.start(
      Mastery.BASELINE_DURATION_S,
      E.assessTimer,
      null,               // onTick
      onAssessmentExpire  // onExpire
    );

    showNextAssessmentProblem();
  }

  // ── showNextAssessmentProblem ─────────────────────────────────────────────
  function showNextAssessmentProblem() {
    if (!Timer.isRunning()) return;

    // Cycle pool if exhausted
    if (_assessment.poolIndex >= _assessment.pool.length) {
      _assessment.pool      = Levels.shuffleArray(_assessment.pool.slice());
      _assessment.poolIndex = 0;
    }

    var pair = _assessment.pool[_assessment.poolIndex++];
    var a = pair[0], b = pair[1];
    var correctAnswer = a * b;
    var expectedDigits = DCPM.getAnswerDigitLength(a, b);

    Display.renderProblem(E.assessProblem, a, b);
    Display.renderAnswerInput(E.assessAnswer, '');

    // Record when this problem was displayed
    _assessment.problemTime = performance.now();
    if (!_assessment.startTime) _assessment.startTime = _assessment.problemTime;

    // Update fact count display
    if (E.assessFactCount) {
      E.assessFactCount.textContent = _assessment.responses.length + ' answered';
    }

    // Activate input — auto-submits when digit count matches
    Input.activate({
      expectedDigits: expectedDigits,
      onDigit: function (buf) {
        Display.renderAnswerInput(E.assessAnswer, buf);
      },
      onSubmit: function (buf) {
        onAssessmentAnswer(a, b, correctAnswer, buf);
      }
    });
  }

  // ── onAssessmentAnswer ────────────────────────────────────────────────────
  function onAssessmentAnswer(a, b, correctAnswer, studentAnswer) {
    var responseMs = performance.now() - _assessment.problemTime;
    var correctDigits = DCPM.countCorrectDigits(correctAnswer, studentAnswer);

    _assessment.responses.push({
      a: a, b: b,
      correctAnswer:  correctAnswer,
      studentAnswer:  studentAnswer,
      correctDigits:  correctDigits,
      responseMs:     responseMs
    });

    // Persist response time
    Mastery.addAttempt(a, b, studentAnswer, (parseInt(studentAnswer,10) === correctAnswer), _assessment.type);
    Mastery.addResponseTime(a, b, responseMs, _assessment.type);

    showNextAssessmentProblem();
  }

  // ── onAssessmentExpire ────────────────────────────────────────────────────
  function onAssessmentExpire() {
    Input.deactivate();

    var elapsedSecs = (_assessment.type === 'BASELINE')
      ? Mastery.BASELINE_DURATION_S
      : Mastery.LEVEL_TEST_DURATION_S;

    var dcpm = DCPM.calculateDCPM(_assessment.responses, elapsedSecs);

    if (_assessment.type === 'BASELINE') {
      enterPlacement(dcpm);
    } else {
      enterLevelTestResult(dcpm);
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // PLACEMENT (after baseline)
  // ═════════════════════════════════════════════════════════════════════════

  function enterPlacement(dcpm) {
    Mastery.recordBaselineResult(dcpm);
    var level = Mastery.getCurrentLevel();
    var msg   = Progression.getPlacementLabel(dcpm);

    Display.showScreen('screen-placement');
    if (E.placementDCPM)    E.placementDCPM.textContent    = 'Your score: ' + dcpm + ' DCPM';
    if (E.placementMessage) E.placementMessage.textContent = msg;
  }

  function handlePlacementNext() {
    var level = Mastery.getCurrentLevel();
    Mastery.setPhase('PRACTICE');
    enterPractice(level);
  }

  // ═════════════════════════════════════════════════════════════════════════
  // PHASE 2: IR PRACTICE
  // ═════════════════════════════════════════════════════════════════════════

  function enterPractice(levelKey) {
    Mastery.setPhase('PRACTICE');
    Mastery.setCurrentLevel(levelKey);

    _practice.levelKey  = levelKey;
    _practice.targets   = Progression.getUnmasteredTargets(levelKey);
    _practice.targetIdx = 0;

    // Restore saved target index if resuming mid-level
    var saved = Mastery.getPracticeState();
    if (saved.levelKey === levelKey && saved.currentTargetIndex < _practice.targets.length) {
      _practice.targetIdx = saved.currentTargetIndex;
    }

    Display.showScreen('screen-practice');
    Display.setLevelLabel(E.practLevelLabel, levelKey);
    Display.hideCorrectionPrompt(E.practCorrection);
    Display.clearFeedback(E.practFeedback);

    _updateTargetProgressLabel();

    // If all facts already mastered, skip to level complete
    if (_practice.targets.length === 0) {
      enterLevelComplete(levelKey);
      return;
    }

    startIRForCurrentTarget(saved);
  }

  // ── startIRForCurrentTarget ───────────────────────────────────────────────
  function startIRForCurrentTarget(savedState) {
    var newFact    = _practice.targets[_practice.targetIdx];
    var knownFacts = Progression.buildKnownFacts(newFact);

    // Restore mid-cycle state if available and matches current fact
    var irSnapshot = (savedState && savedState.irSnapshot) || null;
    var snapshotMatchesFact = irSnapshot &&
      irSnapshot.newFact &&
      irSnapshot.newFact[0] === newFact[0] &&
      irSnapshot.newFact[1] === newFact[1];

    if (snapshotMatchesFact) {
      IR.restoreState(irSnapshot);
    } else {
      IR.startCycle(newFact, knownFacts);
    }

    Mastery.updatePracticeState({
      levelKey:           _practice.levelKey,
      currentTargetIndex: _practice.targetIdx,
      irSnapshot:         IR.getSnapshot()
    });

    showNextIRCard();
  }

  // ── showNextIRCard ────────────────────────────────────────────────────────
  function showNextIRCard() {
    if (!IR.isActive()) return;

    var card = IR.getCurrentCard();
    if (!card) return;

    var a = card[0], b = card[1];
    var correctAnswer  = a * b;
    var expectedDigits = DCPM.getAnswerDigitLength(a, b);
    var progress       = IR.getProgress();
    var inCorrection   = progress && progress.awaitingCorrection;

    Display.renderProblem(E.practProblem, a, b);
    Display.renderAnswerInput(E.practAnswer, '');
    Display.updateIRIndicator(E.practStepLabel, E.practFactType, progress);

    if (progress) {
      Display.updateProgressBar(
        E.practProgressBar,
        E.practProgressPct,
        progress.percentage
      );
    }

    if (inCorrection) {
      // Already in correction — keep the prompt visible, just re-activate input
      Input.activate({
        expectedDigits: expectedDigits,
        onDigit:  function (buf) { Display.renderAnswerInput(E.practAnswer, buf); },
        onSubmit: function (buf) { onIRCorrectionInput(a, b, correctAnswer, buf); }
      });
    } else {
      Display.hideCorrectionPrompt(E.practCorrection);
      Display.clearFeedback(E.practFeedback);

      Input.activate({
        expectedDigits: expectedDigits,
        onDigit:  function (buf) { Display.renderAnswerInput(E.practAnswer, buf); },
        onSubmit: function (buf) { onIRAnswer(a, b, correctAnswer, buf); }
      });
    }
  }

  // ── onIRAnswer ────────────────────────────────────────────────────────────
  function onIRAnswer(a, b, correctAnswer, studentAnswer) {
    var result = IR.submitAnswer(studentAnswer);
    if (!result) return;

    Mastery.addAttempt(a, b, studentAnswer, result.correct, 'PRACTICE');

    if (result.enteringCorrection) {
      // N1 error → show correction prompt and wait
      Display.showCorrectionPrompt(E.practCorrection, correctAnswer);
      Display.showFeedback(E.practFeedback, 'Incorrect', 'incorrect', 0);
      _saveIRSnapshot();
      // Re-activate input for correction
      var expectedDigits = DCPM.getAnswerDigitLength(a, b);
      Input.activate({
        expectedDigits: expectedDigits,
        onDigit:  function (buf) { Display.renderAnswerInput(E.practAnswer, buf); },
        onSubmit: function (buf) { onIRCorrectionInput(a, b, correctAnswer, buf); }
      });
      return;
    }

    if (!result.correct) {
      // Error on a K-fact: flash and move on
      Display.showFeedback(E.practFeedback, 'Answer: ' + correctAnswer, 'incorrect', 1200);
    }

    if (result.complete) {
      onIRCycleComplete(result.masteredCleanly, a, b);
    } else {
      _saveIRSnapshot();
      setTimeout(showNextIRCard, result.correct ? 0 : 300);
    }
  }

  // ── onIRCorrectionInput ───────────────────────────────────────────────────
  function onIRCorrectionInput(a, b, correctAnswer, studentAnswer) {
    var result = IR.submitCorrection(studentAnswer);
    if (!result) return;

    if (result.correct) {
      // Cycle restarted from step 1
      Display.hideCorrectionPrompt(E.practCorrection);
      Display.clearFeedback(E.practFeedback);
      Display.showFeedback(E.practFeedback, 'Good — starting over from Step 1', 'info', 1500);
      _saveIRSnapshot();
      setTimeout(showNextIRCard, 400);
    } else {
      // Still wrong during correction — prompt again
      Display.renderAnswerInput(E.practAnswer, '');
      var expectedDigits = DCPM.getAnswerDigitLength(a, b);
      Input.activate({
        expectedDigits: expectedDigits,
        onDigit:  function (buf) { Display.renderAnswerInput(E.practAnswer, buf); },
        onSubmit: function (buf) { onIRCorrectionInput(a, b, correctAnswer, buf); }
      });
    }
  }

  // ── onIRCycleComplete ─────────────────────────────────────────────────────
  function onIRCycleComplete(masteredCleanly, a, b) {
    if (masteredCleanly) {
      // Mark canonical fact as mastered (both orderings handled via factKey)
      Mastery.markFactMastered(a, b);
      Mastery.markFactMastered(b, a);

      Display.showFeedback(E.practFeedback, 'Fact mastered!', 'correct', 1500);

      _practice.targetIdx++;
      Mastery.updatePracticeState({
        levelKey:           _practice.levelKey,
        currentTargetIndex: _practice.targetIdx,
        irSnapshot:         null
      });

      _updateTargetProgressLabel();

      if (_practice.targetIdx >= _practice.targets.length) {
        // All target facts for this level are mastered
        setTimeout(function () { enterLevelComplete(_practice.levelKey); }, 600);
      } else {
        setTimeout(function () { startIRForCurrentTarget(null); }, 600);
      }
    } else {
      // Cycle ended with errors — restart IR for this fact
      Display.showFeedback(E.practFeedback, 'Let\'s try again!', 'info', 1000);
      setTimeout(function () { startIRForCurrentTarget(null); }, 700);
    }
  }

  // ── _saveIRSnapshot ───────────────────────────────────────────────────────
  function _saveIRSnapshot() {
    Mastery.updatePracticeState({ irSnapshot: IR.getSnapshot() });
  }

  // ── _updateTargetProgressLabel ────────────────────────────────────────────
  function _updateTargetProgressLabel() {
    if (!E.practTargetProgress) return;
    var total   = _practice.targets.length;
    var current = Math.min(_practice.targetIdx + 1, total);
    E.practTargetProgress.textContent = 'Fact ' + current + ' of ' + total;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // LEVEL COMPLETE (all IR done for this level)
  // ═════════════════════════════════════════════════════════════════════════

  function enterLevelComplete(levelKey) {
    Display.showScreen('screen-level-complete');
    if (E.levelCompleteTitle) {
      E.levelCompleteTitle.textContent = 'Level ' + levelKey + ' Practice Complete!';
    }
  }

  function handleLevelTestClicked() {
    var levelKey = Mastery.getCurrentLevel();
    enterLevelTest(levelKey);
  }

  // ═════════════════════════════════════════════════════════════════════════
  // PHASE 3: LEVEL PROGRESSION TEST (1 minute)
  // ═════════════════════════════════════════════════════════════════════════

  function enterLevelTest(levelKey) {
    Mastery.setPhase('LEVEL_TEST');
    Mastery.setCurrentLevel(levelKey);

    Display.showScreen('screen-assessment');
    Display.setPhaseLabel(E.assessPhaseLabel, 'LEVEL_TEST');
    Display.setLevelLabel(E.assessLevelLabel, levelKey);

    _assessment.pool      = Progression.buildAssessmentPool('LEVEL_TEST', levelKey);
    _assessment.poolIndex = 0;
    _assessment.responses = [];
    _assessment.startTime = null;
    _assessment.type      = 'LEVEL_TEST';

    Display.setDCPM(E.assessDCPM, null);

    Timer.start(
      Mastery.LEVEL_TEST_DURATION_S,
      E.assessTimer,
      null,
      onAssessmentExpire
    );

    showNextAssessmentProblem();
  }

  // ═════════════════════════════════════════════════════════════════════════
  // LEVEL TEST RESULT
  // ═════════════════════════════════════════════════════════════════════════

  function enterLevelTestResult(dcpm) {
    var levelKey = Mastery.getCurrentLevel();
    var result   = Progression.evaluateLevelTest(dcpm);

    Mastery.recordLevelTestResult(levelKey, dcpm, result.passed);

    Display.showScreen('screen-test-result');

    if (E.testResultTitle) {
      E.testResultTitle.textContent = result.passed ? 'Level ' + levelKey + ' Passed!' : 'Keep Practising';
    }
    if (E.testResultDCPM) {
      E.testResultDCPM.textContent = dcpm + ' DCPM (need ' + result.threshold + ' to pass)';
    }
    if (E.testResultMessage) {
      E.testResultMessage.textContent = result.passed
        ? 'Great work! Moving to the next level.'
        : 'Not quite — let\'s practise a bit more then try again.';
    }
    if (E.btnTestResultNext) {
      E.btnTestResultNext.textContent = result.passed ? 'Next Level' : 'Practise Again';
    }
  }

  function handleTestResultNext() {
    var levelKey = Mastery.getCurrentLevel();
    var state    = Mastery.getState();
    var passed   = state.passedLevels.indexOf(levelKey) !== -1;

    if (passed) {
      var nextLevel = Levels.getNextLevel(levelKey);
      if (!nextLevel) {
        enterComplete();
      } else {
        Mastery.updatePracticeState({
          levelKey:           nextLevel,
          currentTargetIndex: 0,
          irSnapshot:         null
        });
        enterPractice(nextLevel);
      }
    } else {
      // Retry: reset IR mastery for this level
      Mastery.resetPracticeForLevel(levelKey);
      enterPractice(levelKey);
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // COMPLETE — all levels mastered
  // ═════════════════════════════════════════════════════════════════════════

  function enterComplete() {
    Mastery.setPhase('COMPLETE');
    Display.showScreen('screen-complete');
    var stats = Mastery.getStats();
    Display.renderStats(E.finalStats, stats);
  }

  // ═════════════════════════════════════════════════════════════════════════
  // TEACHER RESET (Ctrl+Alt+R or hidden admin button)
  // ═════════════════════════════════════════════════════════════════════════

  function handleTeacherReset() {
    if (!confirm('Reset all student progress? This cannot be undone.')) return;
    Timer.stop();
    Input.deactivate();
    IR.reset();
    Mastery.resetAll();
    enterWelcome();
  }

  // ═════════════════════════════════════════════════════════════════════════
  // BOOTSTRAP
  // ═════════════════════════════════════════════════════════════════════════

  document.addEventListener('DOMContentLoaded', initApp);

})();
