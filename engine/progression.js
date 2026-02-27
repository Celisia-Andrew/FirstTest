/**
 * engine/progression.js
 * Level Progression Logic
 *
 * This module is a PURE ENGINE — no DOM/UI dependencies.
 * It answers questions about level state and fact selection for both
 * IR practice and timed assessments.
 *
 * ── Responsibilities ─────────────────────────────────────────────────────────
 *  1. Determine which target facts in the current level still need IR work.
 *  2. Assemble the K (known) fact pool for an IR cycle.
 *  3. Build the randomised fact pool for a timed assessment.
 *  4. Decide whether a level is fully practice-complete (all targets mastered).
 *  5. Evaluate level-test DCPM against the pass threshold.
 */

window.Engine = window.Engine || {};

window.Engine.Progression = (function () {

  // ── getUnmasteredTargets ──────────────────────────────────────────────────
  // Returns target facts for levelKey that are NOT yet in masteredFacts.
  // Used to decide which facts still need an IR cycle.
  //
  // @returns {Array[]} array of [a, b] pairs
  function getUnmasteredTargets(levelKey) {
    var targets = Engine.Levels.getLevelTargetFacts(levelKey);
    return targets.filter(function (pair) {
      return !Engine.Mastery.isFactMastered(pair[0], pair[1]);
    });
  }

  // ── isLevelPracticeComplete ───────────────────────────────────────────────
  // Returns true when every target fact in the level is mastered.
  function isLevelPracticeComplete(levelKey) {
    return getUnmasteredTargets(levelKey).length === 0;
  }

  // ── buildKnownFacts ───────────────────────────────────────────────────────
  // Assembles the K-fact pool for an IR cycle.
  //
  // Priority order (spec §3C):
  //   1. Previously mastered facts (from masteredFacts[]), shuffled.
  //   2. If count < 9, supplement with other target facts from the CURRENT
  //      level that have been answered correctly in this session (i.e., are
  //      also in masteredFacts because they were just IR-mastered this session).
  //
  // In practice, both sources come from masteredFacts. We exclude the newFact
  // itself, then take up to 9 entries at random.
  //
  // @param {Array}  newFact  – [a, b] the N1 fact being learned
  // @returns {Array[]} up to 9 [a, b] pairs
  function buildKnownFacts(newFact) {
    var Levels  = Engine.Levels;
    var Mastery = Engine.Mastery;

    var newKey = Levels.factKey(newFact[0], newFact[1]);

    // All mastered fact pairs, excluding N1 itself (both orderings)
    var pool = Mastery.getMasteredFactPairs().filter(function (pair) {
      return Levels.factKey(pair[0], pair[1]) !== newKey;
    });

    // Shuffle so we get a varied selection across cycles
    Levels.shuffleArray(pool);

    return pool.slice(0, 9);
  }

  // ── buildAssessmentPool ───────────────────────────────────────────────────
  // Builds the randomised fact pool for a timed assessment.
  //
  // For BASELINE (Phase 1): all facts across all levels, shuffled.
  // For LEVEL_TEST (Phase 3): facts from current level + all mastered facts.
  //
  // The pool is repeated (cycled) so the 2-min / 1-min timer never runs out
  // of facts — students cycle through the pool as many times as needed.
  //
  // @param {string}  type      – 'BASELINE' | 'LEVEL_TEST'
  // @param {string}  levelKey  – current level (used for LEVEL_TEST)
  // @returns {Array[]} shuffled array of [a, b] pairs (×3 copies for cycling)
  function buildAssessmentPool(type, levelKey) {
    var Levels  = Engine.Levels;
    var Mastery = Engine.Mastery;
    var pool;

    if (type === 'BASELINE') {
      pool = Levels.getAllLevelFacts();
    } else {
      // Level test: current-level facts + all mastered facts
      var currentFacts  = Levels.getLevelFacts(levelKey);
      var masteredPairs = Mastery.getMasteredFactPairs();

      // Combine and deduplicate by canonical key
      var seen = {};
      pool = [];
      currentFacts.concat(masteredPairs).forEach(function (pair) {
        var k = Levels.orderedKey(pair[0], pair[1]);
        if (!seen[k]) {
          seen[k] = true;
          pool.push([pair[0], pair[1]]);
        }
      });

      // Ensure commutative pairs are included
      var extraPool = [];
      pool.forEach(function (pair) {
        var a = pair[0], b = pair[1];
        if (a !== b) {
          var rk = Levels.orderedKey(b, a);
          if (!seen[rk]) {
            seen[rk] = true;
            extraPool.push([b, a]);
          }
        }
      });
      pool = pool.concat(extraPool);

      // If pool is empty (brand-new student), fall back to current level only
      if (pool.length === 0) {
        pool = currentFacts;
      }
    }

    // Shuffle and triple so we never run out during the timed window
    Levels.shuffleArray(pool);
    var tripled = pool.concat(
      Levels.shuffleArray(pool.slice()),
      Levels.shuffleArray(pool.slice())
    );

    return tripled;
  }

  // ── evaluateLevelTest ─────────────────────────────────────────────────────
  // Determines pass/fail for a level progression test.
  // @param {number} dcpm
  // @returns {{ passed: boolean, dcpm: number, threshold: number }}
  function evaluateLevelTest(dcpm) {
    var threshold = Engine.Mastery.MASTERY_DCPM_THRESHOLD;
    return {
      passed:    dcpm >= threshold,
      dcpm:      dcpm,
      threshold: threshold
    };
  }

  // ── getPlacementLabel ─────────────────────────────────────────────────────
  // Returns a human-readable string describing baseline placement.
  function getPlacementLabel(dcpm) {
    var threshold = Engine.Mastery.MASTERY_DCPM_THRESHOLD;
    if (dcpm >= threshold) {
      return 'Great score! Starting at Level ' + Engine.Mastery.ADVANCED_START_LEVEL + '.';
    }
    return 'Starting at Level A. Let\'s build your facts!';
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  return {
    getUnmasteredTargets:    getUnmasteredTargets,
    isLevelPracticeComplete: isLevelPracticeComplete,
    buildKnownFacts:         buildKnownFacts,
    buildAssessmentPool:     buildAssessmentPool,
    evaluateLevelTest:       evaluateLevelTest,
    getPlacementLabel:       getPlacementLabel
  };

})();
