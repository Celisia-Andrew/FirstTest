/**
 * engine/ir.js
 * True Folding-In Incremental Rehearsal (IR) Algorithm
 *
 * This module is a PURE ENGINE — it has zero DOM or UI dependencies.
 * It manages one IR cycle for a single new fact (N1) with up to 9 known
 * facts (K1–K9).
 *
 * ── Folding-In Sequence ────────────────────────────────────────────────────
 *
 *   Step 1:  [N1]
 *   Step 2:  [N1, K1]
 *   Step 3:  [N1, K1, K2]
 *   Step 4:  [N1, K1, K2, K3]
 *   …
 *   Step 10: [N1, K1, K2, K3, K4, K5, K6, K7, K8, K9]
 *
 * Where:
 *   N1      = The new (unknown) fact being introduced
 *   K1–K9   = Up to 9 previously mastered known facts
 *
 * If fewer than 9 known facts are available, the sequence is shortened:
 *   maxSteps = knownFacts.length + 1
 *
 * ── Error Correction Rule (Critical) ──────────────────────────────────────
 *
 *   If N1 is answered INCORRECTLY at any point:
 *     1. Caller receives { correct: false, enteringCorrection: true }
 *     2. The system must display the correct answer and prompt the student.
 *     3. Student types the correct answer → submitCorrection(answer) is called.
 *     4. On success, the ENTIRE sequence restarts from Step 1.
 *     5. hadErrorInCycle resets to false (fresh attempt).
 *
 *   Known-fact (K) errors do NOT trigger restart — the card advances normally.
 *
 * ── Mastery Criteria ──────────────────────────────────────────────────────
 *
 *   A fact is mastered when:
 *     • The full sequence completes (all steps exhausted).
 *     • hadErrorInCycle === false at completion time.
 *
 * ── Ratio ─────────────────────────────────────────────────────────────────
 *   With 9 known facts the ratio is 1 new : 9 known = 1:9  ✓
 */

window.Engine = window.Engine || {};

window.Engine.IR = (function () {

  // ── State ──────────────────────────────────────────────────────────────────
  // A single mutable object representing the in-progress IR cycle.
  // Designed to be fully serialisable to JSON for localStorage persistence.
  var _state = null;

  // ── startCycle ─────────────────────────────────────────────────────────────
  // Initialise a fresh IR cycle.
  //
  // @param {Array}   newFact    – [a, b]  the fact to learn  (N1)
  // @param {Array[]} knownFacts – [[a,b], …]  mastered facts (K1…K9, max 9)
  // @returns {Object} the initial state snapshot
  function startCycle(newFact, knownFacts) {
    var kFacts = (knownFacts || []).slice(0, 9); // enforce max 9

    _state = {
      newFact:           [newFact[0], newFact[1]],
      knownFacts:        kFacts,
      currentStep:       1,         // steps run 1 … maxSteps
      currentCardIndex:  0,         // card position within the current step
      maxSteps:          kFacts.length + 1,
      awaitingCorrection: false,    // true while waiting for student to retype
      hadErrorInCycle:   false,     // true if N1 was ever wrong in this attempt
      isComplete:        false      // true when the full sequence is done
    };

    return getSnapshot();
  }

  // ── restoreState ──────────────────────────────────────────────────────────
  // Re-hydrate an IR cycle from a persisted JSON snapshot.
  // Call this on page reload when the student was mid-cycle.
  function restoreState(snapshot) {
    if (!snapshot) { _state = null; return; }
    _state = {
      newFact:            snapshot.newFact,
      knownFacts:         snapshot.knownFacts || [],
      currentStep:        snapshot.currentStep        || 1,
      currentCardIndex:   snapshot.currentCardIndex   || 0,
      maxSteps:           snapshot.maxSteps           || 1,
      awaitingCorrection: snapshot.awaitingCorrection || false,
      hadErrorInCycle:    snapshot.hadErrorInCycle    || false,
      isComplete:         snapshot.isComplete         || false
    };
  }

  // ── getCurrentCard ─────────────────────────────────────────────────────────
  // Returns the [a, b] fact the student should answer right now.
  // Returns null if no cycle is active or the cycle is complete.
  function getCurrentCard() {
    if (!_state || _state.isComplete) return null;

    // During correction the student re-answers N1
    if (_state.awaitingCorrection) return [_state.newFact[0], _state.newFact[1]];

    // Card 0 in every step is always N1
    if (_state.currentCardIndex === 0) return [_state.newFact[0], _state.newFact[1]];

    // Cards 1+ map to K1, K2, … in order
    return _state.knownFacts[_state.currentCardIndex - 1];
  }

  // ── isCurrentCardNew ──────────────────────────────────────────────────────
  // Returns true when the card currently being asked IS the new fact (N1).
  function isCurrentCardNew() {
    if (!_state) return false;
    return _state.awaitingCorrection || (_state.currentCardIndex === 0);
  }

  // ── submitAnswer ──────────────────────────────────────────────────────────
  // Process the student's answer for the CURRENT card (not correction mode).
  //
  // @param {string|number} studentAnswer
  // @returns {Object} result:
  //   {
  //     correct           : boolean,
  //     correctAnswer     : number,
  //     wasNewFact        : boolean,
  //     enteringCorrection: boolean,  // true when N1 error is detected
  //     restarted         : boolean,  // true when cycle restarted after correction
  //     complete          : boolean,  // true when full cycle finished
  //     masteredCleanly   : boolean   // true when complete AND no N1 errors
  //   }
  function submitAnswer(studentAnswer) {
    if (!_state || _state.isComplete || _state.awaitingCorrection) return null;

    var card          = getCurrentCard();
    var a = card[0], b = card[1];
    var correctAnswer = a * b;
    var correct       = parseInt(studentAnswer, 10) === correctAnswer;
    var wasNewFact    = isCurrentCardNew();

    // ── Error on N1 → enter correction mode ──────────────────────────────
    if (!correct && wasNewFact) {
      _state.hadErrorInCycle    = true;
      _state.awaitingCorrection = true;
      return {
        correct:            false,
        correctAnswer:      correctAnswer,
        wasNewFact:         true,
        enteringCorrection: true,
        restarted:          false,
        complete:           false,
        masteredCleanly:    false
      };
    }

    // ── Correct answer (or error on a K fact) → advance the deck ─────────
    _advanceCard();

    return {
      correct:            correct,
      correctAnswer:      correctAnswer,
      wasNewFact:         wasNewFact,
      enteringCorrection: false,
      restarted:          false,
      complete:           _state.isComplete,
      masteredCleanly:    _state.isComplete && !_state.hadErrorInCycle
    };
  }

  // ── submitCorrection ──────────────────────────────────────────────────────
  // Called when the student types an answer while in correction mode.
  // The student MUST type the correct answer; keep prompting until they do.
  //
  // @param {string|number} studentAnswer
  // @returns {Object}
  //   {
  //     correct     : boolean,
  //     correctAnswer: number,
  //     restarted   : boolean  // true once correct answer typed → cycle reset
  //   }
  function submitCorrection(studentAnswer) {
    if (!_state || !_state.awaitingCorrection) return null;

    var a = _state.newFact[0], b = _state.newFact[1];
    var correctAnswer = a * b;
    var correct = parseInt(studentAnswer, 10) === correctAnswer;

    if (correct) {
      // Restart the entire sequence from Step 1 with a clean error flag
      _state.awaitingCorrection = false;
      _state.currentStep        = 1;
      _state.currentCardIndex   = 0;
      _state.hadErrorInCycle    = false; // Fresh attempt begins
      return { correct: true,  correctAnswer: correctAnswer, restarted: true };
    }

    // Wrong again during correction — keep waiting (no additional restart)
    return { correct: false, correctAnswer: correctAnswer, restarted: false };
  }

  // ── _advanceCard ──────────────────────────────────────────────────────────
  // Internal: move the deck pointer forward by one card.
  // If the step is exhausted, increment the step counter.
  // If all steps are exhausted, mark the cycle complete.
  function _advanceCard() {
    _state.currentCardIndex++;

    // A step S contains S cards (indices 0 … S-1).
    if (_state.currentCardIndex >= _state.currentStep) {
      _state.currentStep++;
      _state.currentCardIndex = 0;

      // All steps finished
      if (_state.currentStep > _state.maxSteps) {
        _state.isComplete = true;
      }
    }
  }

  // ── getProgress ──────────────────────────────────────────────────────────
  // Returns display-friendly progress info for the UI progress bar.
  function getProgress() {
    if (!_state) return null;

    // Total cards in a complete cycle: 1 + 2 + … + maxSteps
    var totalCards = (_state.maxSteps * (_state.maxSteps + 1)) / 2;

    // Cards completed so far: sum of completed steps + cards done in current step
    var completedCards = 0;
    for (var s = 1; s < _state.currentStep; s++) { completedCards += s; }
    completedCards += _state.currentCardIndex;

    return {
      step:              _state.currentStep,
      maxSteps:          _state.maxSteps,
      cardIndex:         _state.currentCardIndex,
      totalCardsInStep:  _state.currentStep,
      completedCards:    completedCards,
      totalCards:        totalCards,
      percentage:        totalCards > 0 ? Math.round((completedCards / totalCards) * 100) : 0,
      awaitingCorrection: _state.awaitingCorrection
    };
  }

  // ── getSnapshot ──────────────────────────────────────────────────────────
  // Returns a plain-object copy of current state — safe for JSON.stringify.
  function getSnapshot() {
    if (!_state) return null;
    return {
      newFact:            [_state.newFact[0], _state.newFact[1]],
      knownFacts:         _state.knownFacts.map(function (f) { return [f[0], f[1]]; }),
      currentStep:        _state.currentStep,
      currentCardIndex:   _state.currentCardIndex,
      maxSteps:           _state.maxSteps,
      awaitingCorrection: _state.awaitingCorrection,
      hadErrorInCycle:    _state.hadErrorInCycle,
      isComplete:         _state.isComplete
    };
  }

  // ── isActive ─────────────────────────────────────────────────────────────
  function isActive() {
    return _state !== null && !_state.isComplete;
  }

  // ── reset ────────────────────────────────────────────────────────────────
  function reset() { _state = null; }

  // ── Public API ────────────────────────────────────────────────────────────
  return {
    startCycle:        startCycle,
    restoreState:      restoreState,
    getCurrentCard:    getCurrentCard,
    isCurrentCardNew:  isCurrentCardNew,
    submitAnswer:      submitAnswer,
    submitCorrection:  submitCorrection,
    getProgress:       getProgress,
    getSnapshot:       getSnapshot,
    isActive:          isActive,
    reset:             reset
  };

})();
