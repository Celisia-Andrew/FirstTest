/**
 * engine/mastery.js
 * State Management, Mastery Criteria & localStorage Persistence
 *
 * This module owns all student data. The UI and App layers must call
 * methods here instead of reading/writing localStorage directly.
 *
 * ── What is stored ───────────────────────────────────────────────────────────
 *   currentLevel      : string  – active level key ("A"…"Z")
 *   currentPhase      : string  – active app phase
 *   masteredFacts     : string[] – canonical keys ("2x3") of IR-mastered facts
 *   passedLevels      : string[] – level keys whose progression test passed
 *   baselineCompleted : boolean
 *   baselineDCPM      : number|null
 *   practiceState     : object  – serialised IR progress within current level
 *   attemptsHistory   : object[]
 *   responseTimes     : object[]
 *   dcpmScores        : object[]
 *
 * ── FUTURE INTEGRATION NOTE ─────────────────────────────────────────────────
 *   Replace the localStorage calls below with Firebase Firestore reads/writes:
 *
 *     // Firebase read example:
 *     // const doc = await db.collection('students').doc(userId).get();
 *     // return doc.data();
 *
 *     // Firebase write example:
 *     // await db.collection('students').doc(userId).set(state);
 *
 *   The _load() and _save() functions below are the only integration points.
 *
 * ── Google OAuth / Firebase Auth integration point ───────────────────────────
 *   When Firebase Auth is added, userId below will come from:
 *     firebase.auth().currentUser.uid
 *   Replace the hardcoded STORAGE_KEY accordingly.
 */

window.Engine = window.Engine || {};

window.Engine.Mastery = (function () {

  var STORAGE_KEY = 'multiplicationFluency_v1';
  var MASTERY_DCPM_THRESHOLD = 40; // DCPM required to pass a level test
  var BASELINE_DURATION_S    = 120; // Phase 1 baseline: 2 minutes
  var LEVEL_TEST_DURATION_S  = 60;  // Phase 3 level test: 1 minute
  var ADVANCED_START_LEVEL   = 'M'; // Starting level when baseline DCPM >= 40

  // ── Default state ──────────────────────────────────────────────────────────
  function _defaultState() {
    return {
      currentLevel:      'A',
      currentPhase:      'WELCOME',     // WELCOME | BASELINE | PRACTICE | LEVEL_TEST | COMPLETE
      masteredFacts:     [],            // ["2x2","2x3",…]
      passedLevels:      [],            // ["A","B",…]
      baselineCompleted: false,
      baselineDCPM:      null,
      practiceState: {
        levelKey:           'A',
        currentTargetIndex: 0,          // index into level's target facts array
        irSnapshot:         null        // serialised Engine.IR state (mid-cycle)
      },
      attemptsHistory:   [],
      responseTimes:     [],
      dcpmScores:        []
    };
  }

  // Internal in-memory state (single source of truth at runtime)
  var _state = null;

  // ── _load ──────────────────────────────────────────────────────────────────
  // Read from localStorage. Falls back to default if nothing is stored.
  // FUTURE: swap body with Firestore read.
  function _load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        // Merge with defaults to handle new fields added in future versions
        _state = Object.assign(_defaultState(), parsed);
        // Ensure nested practiceState is also merged
        _state.practiceState = Object.assign(
          _defaultState().practiceState,
          parsed.practiceState || {}
        );
      } else {
        _state = _defaultState();
      }
    } catch (e) {
      console.warn('[Mastery] Failed to load state from localStorage:', e);
      _state = _defaultState();
    }
  }

  // ── _save ──────────────────────────────────────────────────────────────────
  // Persist current state. FUTURE: swap body with Firestore write.
  function _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(_state));
    } catch (e) {
      console.warn('[Mastery] Failed to save state to localStorage:', e);
    }
  }

  // ── init ──────────────────────────────────────────────────────────────────
  // Must be called once at app startup before any other method.
  function init() {
    _load();
  }

  // ── getState ──────────────────────────────────────────────────────────────
  // Returns a shallow copy of the full state for reading.
  function getState() {
    if (!_state) _load();
    return Object.assign({}, _state);
  }

  // ── getPhase ──────────────────────────────────────────────────────────────
  function getPhase() { return _state.currentPhase; }

  // ── setPhase ──────────────────────────────────────────────────────────────
  function setPhase(phase) {
    _state.currentPhase = phase;
    _save();
  }

  // ── getCurrentLevel ───────────────────────────────────────────────────────
  function getCurrentLevel() { return _state.currentLevel; }

  // ── setCurrentLevel ───────────────────────────────────────────────────────
  function setCurrentLevel(levelKey) {
    _state.currentLevel = levelKey;
    _save();
  }

  // ── isFactMastered ────────────────────────────────────────────────────────
  // Returns true if the canonical key for [a,b] is in masteredFacts.
  function isFactMastered(a, b) {
    var key = Engine.Levels.factKey(a, b);
    return _state.masteredFacts.indexOf(key) !== -1;
  }

  // ── markFactMastered ──────────────────────────────────────────────────────
  // Adds the canonical key to masteredFacts (if not already present).
  function markFactMastered(a, b) {
    var key = Engine.Levels.factKey(a, b);
    if (_state.masteredFacts.indexOf(key) === -1) {
      _state.masteredFacts.push(key);
      _save();
    }
  }

  // ── markLevelFactsMastered ────────────────────────────────────────────────
  // Bulk-marks all target facts in a level as mastered.
  // Called during placement when baseline DCPM >= 40 (pre-mark Levels A–L).
  function markLevelFactsMastered(levelKey) {
    var facts = Engine.Levels.getLevelFacts(levelKey);
    facts.forEach(function (pair) {
      markFactMastered(pair[0], pair[1]);
    });
    if (_state.passedLevels.indexOf(levelKey) === -1) {
      _state.passedLevels.push(levelKey);
    }
    _save();
  }

  // ── getMasteredFacts ──────────────────────────────────────────────────────
  // Returns a copy of the masteredFacts array.
  function getMasteredFacts() {
    return _state.masteredFacts.slice();
  }

  // ── getMasteredFactPairs ──────────────────────────────────────────────────
  // Returns an array of [a, b] pairs for all mastered facts.
  function getMasteredFactPairs() {
    return _state.masteredFacts.map(function (key) {
      var parts = key.split('x');
      return [parseInt(parts[0], 10), parseInt(parts[1], 10)];
    });
  }

  // ── isLevelPassed ─────────────────────────────────────────────────────────
  function isLevelPassed(levelKey) {
    return _state.passedLevels.indexOf(levelKey) !== -1;
  }

  // ── markLevelPassed ───────────────────────────────────────────────────────
  function markLevelPassed(levelKey) {
    if (_state.passedLevels.indexOf(levelKey) === -1) {
      _state.passedLevels.push(levelKey);
    }
    _save();
  }

  // ── recordBaselineResult ──────────────────────────────────────────────────
  // Called after the 2-minute baseline assessment.
  // Applies placement rule: DCPM >= 40 → Level M (pre-mark A–L),
  //                          DCPM <  40 → Level A.
  function recordBaselineResult(dcpm) {
    _state.baselineCompleted = true;
    _state.baselineDCPM      = dcpm;
    _state.dcpmScores.push({ phase: 'BASELINE', dcpm: dcpm, ts: Date.now() });

    if (dcpm >= MASTERY_DCPM_THRESHOLD) {
      // Advanced placement: pre-mark all levels before M
      var Levels = Engine.Levels;
      var advIdx = Levels.LEVEL_ORDER.indexOf(ADVANCED_START_LEVEL);
      for (var i = 0; i < advIdx; i++) {
        markLevelFactsMastered(Levels.LEVEL_ORDER[i]);
      }
      _state.currentLevel = ADVANCED_START_LEVEL;
      _state.practiceState.levelKey           = ADVANCED_START_LEVEL;
      _state.practiceState.currentTargetIndex = 0;
      _state.practiceState.irSnapshot         = null;
    } else {
      _state.currentLevel = 'A';
      _state.practiceState.levelKey           = 'A';
      _state.practiceState.currentTargetIndex = 0;
      _state.practiceState.irSnapshot         = null;
    }
    _save();
  }

  // ── recordLevelTestResult ─────────────────────────────────────────────────
  // Called after a 1-minute level progression test.
  // @param {string}  levelKey
  // @param {number}  dcpm
  // @param {boolean} passed  – true if dcpm >= MASTERY_DCPM_THRESHOLD
  function recordLevelTestResult(levelKey, dcpm, passed) {
    _state.dcpmScores.push({ phase: 'LEVEL_TEST', level: levelKey, dcpm: dcpm, passed: passed, ts: Date.now() });
    if (passed) {
      markLevelPassed(levelKey);
    }
    _save();
  }

  // ── getPracticeState ──────────────────────────────────────────────────────
  function getPracticeState() {
    return Object.assign({}, _state.practiceState);
  }

  // ── updatePracticeState ───────────────────────────────────────────────────
  // Persists partial updates to the practiceState (e.g., after advancing
  // to the next target fact or mid-IR-cycle progress).
  function updatePracticeState(updates) {
    Object.assign(_state.practiceState, updates);
    _save();
  }

  // ── resetPracticeForLevel ─────────────────────────────────────────────────
  // Resets progress for a level so the student re-does IR on all target facts.
  // Called when a level progression test is FAILED.
  function resetPracticeForLevel(levelKey) {
    // Un-master target facts so IR runs again
    var targets = Engine.Levels.getLevelTargetFacts(levelKey);
    targets.forEach(function (pair) {
      var key = Engine.Levels.factKey(pair[0], pair[1]);
      var idx = _state.masteredFacts.indexOf(key);
      if (idx !== -1) _state.masteredFacts.splice(idx, 1);
      // Also remove commutative
      var ck = Engine.Levels.factKey(pair[1], pair[0]);
      var cidx = _state.masteredFacts.indexOf(ck);
      if (cidx !== -1) _state.masteredFacts.splice(cidx, 1);
    });

    _state.practiceState = {
      levelKey:           levelKey,
      currentTargetIndex: 0,
      irSnapshot:         null
    };
    _save();
  }

  // ── addAttempt ────────────────────────────────────────────────────────────
  // Record a single problem attempt for history.
  function addAttempt(factA, factB, studentAnswer, correct, phase) {
    _state.attemptsHistory.push({
      fact:    factA + 'x' + factB,
      answer:  studentAnswer,
      correct: correct,
      phase:   phase,
      ts:      Date.now()
    });
    // Keep history from growing unbounded (retain last 2000 attempts)
    if (_state.attemptsHistory.length > 2000) {
      _state.attemptsHistory.splice(0, 200);
    }
    _save();
  }

  // ── addResponseTime ───────────────────────────────────────────────────────
  function addResponseTime(factA, factB, timeMs, phase) {
    _state.responseTimes.push({
      fact:   factA + 'x' + factB,
      timeMs: timeMs,
      phase:  phase,
      ts:     Date.now()
    });
    if (_state.responseTimes.length > 2000) {
      _state.responseTimes.splice(0, 200);
    }
    _save();
  }

  // ── getStats ──────────────────────────────────────────────────────────────
  // Returns summary statistics for the completion / progress screen.
  function getStats() {
    return {
      currentLevel:      _state.currentLevel,
      masteredFactCount: _state.masteredFacts.length,
      passedLevelCount:  _state.passedLevels.length,
      baselineDCPM:      _state.baselineDCPM,
      latestDCPM:        _state.dcpmScores.length > 0
                           ? _state.dcpmScores[_state.dcpmScores.length - 1].dcpm
                           : null,
      dcpmScores:        _state.dcpmScores.slice()
    };
  }

  // ── reset (Teacher Reset) ─────────────────────────────────────────────────
  // Clears ALL student data. Triggered by Ctrl+Alt+R or hidden admin button.
  function resetAll() {
    localStorage.removeItem(STORAGE_KEY);
    _state = _defaultState();
  }

  // ── Expose constants ───────────────────────────────────────────────────────
  return {
    MASTERY_DCPM_THRESHOLD:  MASTERY_DCPM_THRESHOLD,
    BASELINE_DURATION_S:     BASELINE_DURATION_S,
    LEVEL_TEST_DURATION_S:   LEVEL_TEST_DURATION_S,
    ADVANCED_START_LEVEL:    ADVANCED_START_LEVEL,

    init:                    init,
    getState:                getState,
    getPhase:                getPhase,
    setPhase:                setPhase,
    getCurrentLevel:         getCurrentLevel,
    setCurrentLevel:         setCurrentLevel,
    isFactMastered:          isFactMastered,
    markFactMastered:        markFactMastered,
    markLevelFactsMastered:  markLevelFactsMastered,
    getMasteredFacts:        getMasteredFacts,
    getMasteredFactPairs:    getMasteredFactPairs,
    isLevelPassed:           isLevelPassed,
    markLevelPassed:         markLevelPassed,
    recordBaselineResult:    recordBaselineResult,
    recordLevelTestResult:   recordLevelTestResult,
    getPracticeState:        getPracticeState,
    updatePracticeState:     updatePracticeState,
    resetPracticeForLevel:   resetPracticeForLevel,
    addAttempt:              addAttempt,
    addResponseTime:         addResponseTime,
    getStats:                getStats,
    resetAll:                resetAll
  };

})();
