/**
 * engine/levels.js
 * DI Level Map for Multiplication Fluency System
 *
 * Each level contains 3-4 target multiplication facts following the
 * Direct Instruction (DI) progression from easier to harder fact families.
 *
 * Commutative property applies: if [a,b] is a target, [b,a] is also practiced.
 *
 * Levels A–O: Cover all unique facts in the 2–10 multiplication tables.
 * Levels P–V: Introduce 11× and 12× table facts.
 * Levels W–Z: Fluency review of the hardest/most commonly confused facts.
 *
 * FUTURE INTEGRATION NOTE: This level map can be loaded from a Firebase/cloud
 * database to allow teacher customization of fact families and level order.
 * Replace the LEVELS object below with a Firestore document fetch.
 */

window.Engine = window.Engine || {};

window.Engine.Levels = (function () {

  // ── Level Definitions ──────────────────────────────────────────────────────
  // Each key is a single uppercase letter (A–Z).
  // facts: array of [a, b] pairs — the TARGET facts introduced at this level.
  const LEVELS = {
    A: { facts: [[2,2],[2,3],[2,4]] },
    B: { facts: [[2,5],[2,6],[2,7]] },
    C: { facts: [[2,8],[2,9],[2,10]] },
    D: { facts: [[3,3],[3,4],[3,5]] },
    E: { facts: [[3,6],[3,7],[3,8]] },
    F: { facts: [[3,9],[3,10],[4,4]] },
    G: { facts: [[4,5],[4,6],[4,7]] },
    H: { facts: [[4,8],[4,9],[4,10]] },
    I: { facts: [[5,5],[5,6],[5,7]] },
    J: { facts: [[5,8],[5,9],[5,10]] },
    K: { facts: [[6,6],[6,7],[6,8]] },
    L: { facts: [[6,9],[6,10],[7,7]] },
    M: { facts: [[7,8],[7,9],[7,10]] },
    N: { facts: [[8,8],[8,9],[8,10]] },
    O: { facts: [[9,9],[9,10],[10,10]] },
    P: { facts: [[2,11],[3,11],[4,11]] },
    Q: { facts: [[5,11],[6,11],[7,11]] },
    R: { facts: [[8,11],[9,11],[10,11]] },
    S: { facts: [[11,11],[2,12],[3,12]] },
    T: { facts: [[4,12],[5,12],[6,12]] },
    U: { facts: [[7,12],[8,12],[9,12]] },
    V: { facts: [[10,12],[11,12],[12,12]] },
    // ── Review levels: targets are the statistically hardest facts ─────────
    W: { facts: [[6,7],[7,8],[8,9],[6,8]] },
    X: { facts: [[6,9],[7,9],[9,6],[8,7]] },
    Y: { facts: [[9,11],[8,12],[9,12],[11,9]] },
    Z: { facts: [[12,11],[7,12],[8,11],[12,9]] }
  };

  // Ordered array of level keys A → Z
  const LEVEL_ORDER = Object.keys(LEVELS);

  // ── Helper: canonical fact key ─────────────────────────────────────────────
  // Always stores the smaller operand first so 3×7 and 7×3 share the key "3x7".
  function factKey(a, b) {
    return a <= b ? a + 'x' + b : b + 'x' + a;
  }

  // ── Helper: raw string key preserving order (for display lookups) ──────────
  function orderedKey(a, b) {
    return a + 'x' + b;
  }

  // ── getLevelTargetFacts ────────────────────────────────────────────────────
  // Returns only the explicitly listed [a,b] pairs for a level.
  // Commutative pairs are NOT duplicated here; see getLevelFacts() for those.
  function getLevelTargetFacts(levelKey) {
    const level = LEVELS[levelKey];
    if (!level) return [];
    return level.facts.map(function (pair) { return [pair[0], pair[1]]; });
  }

  // ── getLevelFacts ──────────────────────────────────────────────────────────
  // Returns all facts for a level INCLUDING commutative pairs.
  // Used when building the fact pool for timed assessments.
  function getLevelFacts(levelKey) {
    const level = LEVELS[levelKey];
    if (!level) return [];
    var facts = [];
    level.facts.forEach(function (pair) {
      var a = pair[0], b = pair[1];
      facts.push([a, b]);
      if (a !== b) facts.push([b, a]);
    });
    return facts;
  }

  // ── getAllFactsUpToLevel ────────────────────────────────────────────────────
  // Returns every fact (with commutative pairs) from Level A through levelKey.
  // Used to build the fact pool for level progression tests.
  function getAllFactsUpToLevel(levelKey) {
    var facts = [];
    for (var i = 0; i < LEVEL_ORDER.length; i++) {
      var key = LEVEL_ORDER[i];
      facts = facts.concat(getLevelFacts(key));
      if (key === levelKey) break;
    }
    return facts;
  }

  // ── getNextLevel ──────────────────────────────────────────────────────────
  // Returns the key of the level after levelKey, or null if already at Z.
  function getNextLevel(levelKey) {
    var idx = LEVEL_ORDER.indexOf(levelKey);
    if (idx < 0 || idx >= LEVEL_ORDER.length - 1) return null;
    return LEVEL_ORDER[idx + 1];
  }

  // ── getPreviousLevel ──────────────────────────────────────────────────────
  function getPreviousLevel(levelKey) {
    var idx = LEVEL_ORDER.indexOf(levelKey);
    if (idx <= 0) return null;
    return LEVEL_ORDER[idx - 1];
  }

  // ── isValidLevel ─────────────────────────────────────────────────────────
  function isValidLevel(levelKey) {
    return LEVELS.hasOwnProperty(levelKey);
  }

  // ── getAllLevelFacts ───────────────────────────────────────────────────────
  // Returns ALL facts across every level (with commutative pairs).
  // Used for the baseline assessment randomised pool.
  function getAllLevelFacts() {
    var facts = [];
    LEVEL_ORDER.forEach(function (key) {
      facts = facts.concat(getLevelFacts(key));
    });
    return facts;
  }

  // ── shuffleArray ──────────────────────────────────────────────────────────
  // Fisher-Yates in-place shuffle. Exposed because both engine and UI use it.
  function shuffleArray(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  return {
    LEVELS: LEVELS,
    LEVEL_ORDER: LEVEL_ORDER,
    factKey: factKey,
    orderedKey: orderedKey,
    getLevelTargetFacts: getLevelTargetFacts,
    getLevelFacts: getLevelFacts,
    getAllFactsUpToLevel: getAllFactsUpToLevel,
    getAllLevelFacts: getAllLevelFacts,
    getNextLevel: getNextLevel,
    getPreviousLevel: getPreviousLevel,
    isValidLevel: isValidLevel,
    shuffleArray: shuffleArray
  };

})();
