/* ═══════════════════════════════════════════════════════════════════════
   algorithms.js — Core pedagogical algorithms.

   Public functions (all global, no module system needed for SPA):
     calculateDCPM(correctDigits, elapsedSeconds)
     buildSessionBank(unknown, knownPool, levelKey)
     generateIRSequence(unknown, sessionBank)
     generateRuleBasedIRSequence(levelKey, sessionBank)
     buildMasteryCheckSequence(unknown, allMasteredFacts)
     buildRuleBasedMasteryCheckSequence(levelKey, allMasteredFacts)
     buildLevelTestFacts(currentLevelKey, masteredFactKeys)
     buildLevelWeightedFacts(levelKeys, count)
════════════════════════════════════════════════════════════════════════ */

'use strict';

/* ─────────────────────────────────────────────
   DCPM
   Formula: (correctDigits / seconds) × 60
───────────────────────────────────────────── */
function calculateDCPM(correctDigits, elapsedSeconds) {
  if (elapsedSeconds <= 0) return 0;
  return (correctDigits / elapsedSeconds) * 60;
}

/* ─────────────────────────────────────────────
   LEVEL-WEIGHTED FACT GENERATOR  (#2 — Fair Sampling)

   Instead of a flat list (which over-represents large levels like A & F),
   this picks a random LEVEL first, then a random fact from that level.
   Every level gets equal probability regardless of fact count.

   @param {string[]} levelKeys  Array of level keys to sample from (e.g. LEVEL_ORDER)
   @param {number}   count      How many problem cards to generate
   @returns {Array<{display, answer, fact}>}
───────────────────────────────────────────── */
function buildLevelWeightedFacts(levelKeys, count) {
  const result = [];
  for (let i = 0; i < count; i++) {
    const lk    = levelKeys[Math.floor(Math.random() * levelKeys.length)];
    const facts = LEVEL_MAP[lk].facts;
    const f     = facts[Math.floor(Math.random() * facts.length)];
    result.push({ display: `${f[0]} × ${f[1]}`, answer: factProduct(f), fact: f });
  }
  return result;
}

/* ─────────────────────────────────────────────
   BASELINE FACTS  (2-minute test, all levels A-Z)
───────────────────────────────────────────── */
function buildBaselineFacts() {
  return buildLevelWeightedFacts(LEVEL_ORDER, 240);
}

/* ─────────────────────────────────────────────
   DIAGNOSTIC FACTS  (1-minute subtest, level range)
───────────────────────────────────────────── */
function buildDiagnosticFacts(startKey, endKey) {
  // Collect all level keys in [startKey, endKey]
  const keys = [];
  let inRange = false;
  for (const lk of LEVEL_ORDER) {
    if (lk === startKey) inRange = true;
    if (inRange) keys.push(lk);
    if (lk === endKey) break;
  }
  if (keys.length === 0) return [];
  return buildLevelWeightedFacts(keys, 120);
}

/* ─────────────────────────────────────────────
   HIERARCHICAL FACT PARTITIONING  (for Session Bank selection)

   Given an unknown [a, b] and a pool of mastered facts, split pool into:
     tier1 — shares BOTH factors with unknown
     tier2 — shares exactly ONE factor
     tier3 — shares no factors
───────────────────────────────────────────── */
function partitionKnownsByTier(unknown, knownFacts) {
  const [ua, ub] = unknown;
  const tier1 = [], tier2 = [], tier3 = [];

  for (const fact of knownFacts) {
    const [a, b] = fact;
    const shared = ((a === ua || a === ub) ? 1 : 0)
                 + ((b === ua || b === ub) ? 1 : 0);
    if      (shared === 2) tier1.push(fact);
    else if (shared === 1) tier2.push(fact);
    else                   tier3.push(fact);
  }
  return { tier1, tier2, tier3 };
}

/* ─────────────────────────────────────────────
   SESSION BANK BUILDER  (#5 — Hierarchical selection)

   Selects exactly 9 (or fewer if pool is small) known cards for a U1 cycle.
   Priority: Tier1 → Tier2 → Tier3 (random within each tier).

   Special cases:
   - Level A unknowns: no prior multiplication facts → use 9 addition/subtraction facts.
   - Level F unknowns: mastered pool is A-E; partition uses [0, n] representative.

   @param {[number,number]} unknown    The target fact [a, b]
   @param {[number,number][]} knownPool  All mastered mult facts as [a,b] pairs
   @param {string} levelKey            Current level key (used for A special-case)
   @returns {Array<{display, answer, isUnknown, fact}>}  Up to 9 known cards
───────────────────────────────────────────── */
function buildSessionBank(unknown, knownPool, levelKey) {
  const TARGET = 9;

  // Level A: no prior multiplication facts — always use addition/subtraction knowns
  if (levelKey === 'A') {
    return LEVEL_A_ADDITION_KNOWNS.map(k => ({
      display: k.display,
      answer:  k.answer,
      isUnknown: false,
      fact: null,
    }));
  }

  // All other levels: hierarchical selection from knownPool
  if (knownPool.length === 0) {
    // Edge case: somehow empty pool (should not happen past Level A)
    return LEVEL_A_ADDITION_KNOWNS.slice(0, TARGET).map(k => ({
      display: k.display, answer: k.answer, isUnknown: false, fact: null,
    }));
  }

  const { tier1, tier2, tier3 } = partitionKnownsByTier(unknown, knownPool);
  const selected = [];

  const t1 = sample(tier1, Math.min(tier1.length, TARGET));
  selected.push(...t1);

  if (selected.length < TARGET) {
    const t2 = sample(tier2, Math.min(tier2.length, TARGET - selected.length));
    selected.push(...t2);
  }

  if (selected.length < TARGET) {
    const t3 = sample(tier3, Math.min(tier3.length, TARGET - selected.length));
    selected.push(...t3);
  }

  return selected.map(fact => ({
    display:   `${fact[0]} × ${fact[1]}`,
    answer:    factProduct(fact),
    isUnknown: false,
    fact,
  }));
}

/* ─────────────────────────────────────────────
   IR SEQUENCE GENERATOR  (#4 & #5 — Shuffled Folding-In)

   Produces the full 10-step (U + up to 9 Knowns) flat sequence.
   Total cards = 1 + 2 + 3 + … + (n+1) where n = sessionBank.length (≤9).

   Structure:
     Step 1:  [U]
     Step 2:  [U, K(random)]
     Step 3:  [U, K(rand), K(rand, unique-per-step)]
     ...
     Step 10: [U, K×9 unique random draws from bank]

   The bank is fixed for the entire U1 cycle.  The K SLOTS within each
   step are re-randomised every time this function is called (so restarts
   after an error produce a fresh shuffle from the same bank).

   @param {[number,number]} unknown      Target fact [a,b]
   @param {Array}           sessionBank  9-fact bank returned by buildSessionBank()
   @returns {Array<{display, answer, isUnknown, fact}>}
───────────────────────────────────────────── */
function generateIRSequence(unknown, sessionBank) {
  const unknownCard = {
    display:   `${unknown[0]} × ${unknown[1]}`,
    answer:    factProduct(unknown),
    isUnknown: true,
    fact:      unknown,
  };

  const sequence = [];

  // Step 1: just [U]
  sequence.push({ ...unknownCard });

  // Steps 2 … (bankSize + 1): [U, K×i]
  for (let i = 1; i <= sessionBank.length; i++) {
    sequence.push({ ...unknownCard });
    // Pick i unique random knowns from the bank for THIS step
    const picked = sample(sessionBank, i);
    for (const k of picked) {
      sequence.push({ ...k });
    }
  }

  return sequence;
}

/* ─────────────────────────────────────────────
   RULE-BASED IR SEQUENCE  (#2 — Levels A & F)

   For commutative levels (A=1s, F=0s), we treat the entire family as
   ONE learning target.  The "unknown" slot rotates through the level's
   fact pool so the student practises all permutations naturally within
   the single 10-step folding-in cycle.

   @param {string} levelKey      'A' or 'F'
   @param {Array}  sessionBank   9-fact bank (addition facts for A; mastered facts for F)
   @returns {Array<{display, answer, isUnknown, fact}>}
───────────────────────────────────────────── */
function generateRuleBasedIRSequence(levelKey, sessionBank) {
  const levelFacts  = LEVEL_MAP[levelKey].facts;
  const rotatingPool = shuffle(levelFacts.slice());  // random rotation order
  let   poolIdx      = 0;

  function nextUnknownCard() {
    const f = rotatingPool[poolIdx % rotatingPool.length];
    poolIdx++;
    return { display: `${f[0]} × ${f[1]}`, answer: factProduct(f), isUnknown: true, fact: f };
  }

  const sequence = [];

  // Step 1
  sequence.push(nextUnknownCard());

  // Steps 2 … (bankSize + 1)
  for (let i = 1; i <= sessionBank.length; i++) {
    sequence.push(nextUnknownCard());
    const picked = sample(sessionBank, i);
    for (const k of picked) {
      sequence.push({ ...k });
    }
  }

  return sequence;
}

/* ─────────────────────────────────────────────
   MASTERY CHECK SEQUENCE  (1-minute, individual fact)

   U1 appears at random intervals of 5–10 problems.
   Filler facts are purely random from allMasteredFacts.
   If no mastered facts exist yet, U1 fills all slots.
───────────────────────────────────────────── */
function buildMasteryCheckSequence(unknown, allMasteredFacts) {
  const MAX_PROBLEMS = 120;
  const sequence     = [];
  let nextUnknownAt  = 5 + Math.floor(Math.random() * 6);

  const unknownDisplay = `${unknown[0]} × ${unknown[1]}`;
  const unknownAnswer  = factProduct(unknown);

  for (let i = 0; i < MAX_PROBLEMS; i++) {
    if (i === nextUnknownAt) {
      sequence.push({ display: unknownDisplay, answer: unknownAnswer, isUnknown: true, fact: unknown });
      nextUnknownAt = i + 5 + Math.floor(Math.random() * 6);
    } else if (allMasteredFacts.length > 0) {
      const f      = allMasteredFacts[Math.floor(Math.random() * allMasteredFacts.length)];
      const parsed = Array.isArray(f) ? f : parseFactKey(f);
      sequence.push({ display: `${parsed[0]} × ${parsed[1]}`, answer: factProduct(parsed), isUnknown: false, fact: parsed });
    } else {
      // No mastered facts yet → repeat unknown
      sequence.push({ display: unknownDisplay, answer: unknownAnswer, isUnknown: true, fact: unknown });
    }
  }

  return sequence;
}

/* ─────────────────────────────────────────────
   RULE-BASED MASTERY CHECK SEQUENCE  (Levels A & F)

   For commutative levels the "unknown" is the whole family.
   Level facts appear randomly every 5–10 problems.
   Filler: addition facts (Level A) or random mastered mult facts (Level F+).
───────────────────────────────────────────── */
function buildRuleBasedMasteryCheckSequence(levelKey, allMasteredFacts) {
  const levelFacts  = LEVEL_MAP[levelKey].facts;
  const MAX         = 120;
  const sequence    = [];
  let nextLevelAt   = 5 + Math.floor(Math.random() * 6);

  for (let i = 0; i < MAX; i++) {
    if (i === nextLevelAt) {
      const f = levelFacts[Math.floor(Math.random() * levelFacts.length)];
      sequence.push({ display: `${f[0]} × ${f[1]}`, answer: factProduct(f), isUnknown: true, fact: f });
      nextLevelAt = i + 5 + Math.floor(Math.random() * 6);
    } else if (levelKey === 'A') {
      // Filler: addition/subtraction facts
      const k = LEVEL_A_ADDITION_KNOWNS[Math.floor(Math.random() * LEVEL_A_ADDITION_KNOWNS.length)];
      sequence.push({ display: k.display, answer: k.answer, isUnknown: false, fact: null });
    } else if (allMasteredFacts.length > 0) {
      // Filler: random mastered multiplication fact
      const f      = allMasteredFacts[Math.floor(Math.random() * allMasteredFacts.length)];
      const parsed = Array.isArray(f) ? f : parseFactKey(f);
      sequence.push({ display: `${parsed[0]} × ${parsed[1]}`, answer: factProduct(parsed), isUnknown: false, fact: parsed });
    } else {
      const f = levelFacts[Math.floor(Math.random() * levelFacts.length)];
      sequence.push({ display: `${f[0]} × ${f[1]}`, answer: factProduct(f), isUnknown: true, fact: f });
    }
  }

  return sequence;
}

/* ─────────────────────────────────────────────
   LEVEL TEST FACTS
   1-minute test: current level facts + all mastered previous facts.
   Uses level-weighted sampling to balance representation.
───────────────────────────────────────────── */
function buildLevelTestFacts(currentLevelKey, masteredFactKeys) {
  // Levels to sample from: all mastered levels + current level
  const masteredLevelKeys = [];
  for (const lk of LEVEL_ORDER) {
    const allMastered = LEVEL_MAP[lk].facts.every(f => masteredFactKeys.includes(factKey(f)));
    if (allMastered && lk !== currentLevelKey) masteredLevelKeys.push(lk);
    if (lk === currentLevelKey) break;
  }
  const levelKeys = [...masteredLevelKeys, currentLevelKey];
  return buildLevelWeightedFacts(levelKeys, 120);
}
