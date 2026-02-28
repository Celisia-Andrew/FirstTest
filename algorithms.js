/* ═══════════════════════════════════════════════════════════════════════
   algorithms.js — Core pedagogical algorithms.

   Exports (global functions, no module system required for SPA):
     calculateDCPM(correctDigits, elapsedSeconds)
     generateIRSequence(unknown, masteredFacts, currentLevelKey, factIndexInLevel)
     buildMasteryCheckSequence(unknown, allMasteredFacts, durationSeconds)
     buildLevelTestFacts(currentLevelKey, allMasteredFacts)
     buildDiagnosticFacts(startKey, endKey)
     buildBaselineFacts()
════════════════════════════════════════════════════════════════════════ */

'use strict';

/* ─────────────────────────────────────────────
   DCPM — Digits Correct Per Minute
   Spec: count correct digits (right-aligned), scaled to 60 seconds.
───────────────────────────────────────────── */
function calculateDCPM(correctDigits, elapsedSeconds) {
  if (elapsedSeconds <= 0) return 0;
  return (correctDigits / elapsedSeconds) * 60;
}

/* ─────────────────────────────────────────────
   KNOWN-FACT HIERARCHY  (for IR sequence building)

   Given an unknown fact [a, b] and a pool of known facts,
   partition knowns into three buckets:
     tier1: share BOTH factors (a and b)
     tier2: share exactly ONE factor (a OR b)
     tier3: everything else
───────────────────────────────────────────── */
function partitionKnownsByTier(unknown, knownFacts) {
  const [ua, ub] = unknown;
  const tier1 = [], tier2 = [], tier3 = [];

  for (const fact of knownFacts) {
    const [a, b] = fact;
    const shareA = (a === ua || a === ub);
    const shareB = (b === ua || b === ub);
    const shared = (shareA ? 1 : 0) + (shareB ? 1 : 0);
    if (shared === 2)      tier1.push(fact);
    else if (shared === 1) tier2.push(fact);
    else                   tier3.push(fact);
  }
  return { tier1, tier2, tier3 };
}

/**
 * Collect up to 9 known facts for the IR sequence.
 * Priority: tier1 → tier2 → tier3 (random within each tier).
 *
 * knownMultFacts: Array of [a,b] pairs that are already mastered
 *   (all facts from previous levels + prior facts in current level).
 * isLevelA: boolean — if true, return addition/subtraction stubs instead.
 */
function selectKnownFacts(unknown, knownMultFacts, isLevelA) {
  const TARGET = 9;

  // Level A: no prior multiplication facts; use addition/subtraction knowns
  if (isLevelA) {
    // Return copies of the LEVEL_A_ADDITION_KNOWNS objects (defined in data.js)
    return LEVEL_A_ADDITION_KNOWNS.slice();
  }

  const { tier1, tier2, tier3 } = partitionKnownsByTier(unknown, knownMultFacts);

  const selected = [];

  // Take all tier1 (at most TARGET)
  const t1 = sample(tier1, Math.min(tier1.length, TARGET));
  selected.push(...t1);

  // Fill from tier2
  if (selected.length < TARGET) {
    const need = TARGET - selected.length;
    const t2 = sample(tier2, Math.min(tier2.length, need));
    selected.push(...t2);
  }

  // Fill remainder from tier3
  if (selected.length < TARGET) {
    const need = TARGET - selected.length;
    const t3 = sample(tier3, Math.min(tier3.length, need));
    selected.push(...t3);
  }

  // Map to the same shape as addition knowns for uniform handling downstream
  return selected.map(fact => ({
    fact,
    display: `${fact[0]} × ${fact[1]}`,
    answer: factProduct(fact),
  }));
}

/* ─────────────────────────────────────────────
   INCREMENTAL REHEARSAL (IR) SEQUENCE GENERATOR

   Returns an ordered array of "cards" for a single IR session on unknown U.
   Each card: { display, answer, isUnknown, fact|null }

   Sequence structure (1:9 ratio):
     [U]
     [U, K1]
     [U, K1, K2]
     ...
     [U, K1, K2, ..., K9]

   But rather than re-presenting all previous cards, we produce the
   FLAT interleaved sequence:
     U, K1, U, K2, U, K3, ... U, K9
   which achieves the same effect and is simpler to navigate.

   Spec from requirements:
     U1 → (U1, K1) → (U1, K1, K2) → ... → (U1, K1, ... K9)
   Interpretation: after each new K is introduced, the student sees
   the whole sequence from U1 again. We implement this as rounds:
     Round 0: [U]
     Round 1: [U, K1]
     Round 2: [U, K1, K2]
     ... etc.
   This produces a sequence that grows incrementally.
───────────────────────────────────────────── */

/**
 * Generate the full IR card sequence for one unknown.
 * @param {[number,number]} unknown  - the target fact [a,b]
 * @param {Array}           knownPool - known mult facts as [a,b] pairs
 * @param {boolean}         isLevelA
 * @returns {Array<{display:string, answer:number, isUnknown:boolean, fact:[number,number]|null}>}
 */
function generateIRSequence(unknown, knownPool, isLevelA) {
  const unknownCard = {
    display: `${unknown[0]} × ${unknown[1]}`,
    answer: factProduct(unknown),
    isUnknown: true,
    fact: unknown,
  };

  const knowns = selectKnownFacts(unknown, knownPool, isLevelA);

  // Build rounds: round i has cards [U, K0..Ki-1]
  // Flatten into a sequence
  const sequence = [];

  // Round 0: just the unknown
  sequence.push({ ...unknownCard });

  for (let i = 0; i < knowns.length; i++) {
    const k = knowns[i];
    const knownCard = {
      display: k.display || `${k.fact[0]} × ${k.fact[1]}`,
      answer: k.answer,
      isUnknown: false,
      fact: k.fact || null,
    };

    // Present: U, K0, K1, ... Ki  (a new round starts with U)
    sequence.push({ ...unknownCard });
    for (let j = 0; j <= i; j++) {
      const kj = knowns[j];
      sequence.push({
        display: kj.display || `${kj.fact[0]} × ${kj.fact[1]}`,
        answer: kj.answer,
        isUnknown: false,
        fact: kj.fact || null,
      });
    }
  }

  return sequence;
}

/* ─────────────────────────────────────────────
   MINI MASTERY CHECK SEQUENCE

   After completing the full IR sequence for U1, run a 1-minute test.
   Rules:
   - U1 appears randomly every 5–10 facts (unpredictable)
   - Other facts are purely random from allMasteredFacts
   - Returns a generator-style "infinite" array large enough for 1 min.
     (~60 problems at 1/second; we generate 120 to be safe)
───────────────────────────────────────────── */
function buildMasteryCheckSequence(unknown, allMasteredFacts) {
  const MAX_PROBLEMS = 120;
  const sequence = [];
  let nextUnknownAt = 5 + Math.floor(Math.random() * 6); // first U at index 5-10

  const unknownDisplay = `${unknown[0]} × ${unknown[1]}`;
  const unknownAnswer  = factProduct(unknown);

  for (let i = 0; i < MAX_PROBLEMS; i++) {
    if (i === nextUnknownAt) {
      sequence.push({ display: unknownDisplay, answer: unknownAnswer, isUnknown: true, fact: unknown });
      nextUnknownAt = i + 5 + Math.floor(Math.random() * 6);
    } else {
      // Random from mastered facts (can include unknown itself if already mastered)
      if (allMasteredFacts.length > 0) {
        const f = allMasteredFacts[Math.floor(Math.random() * allMasteredFacts.length)];
        const parsed = Array.isArray(f) ? f : parseFactKey(f);
        sequence.push({ display: `${parsed[0]} × ${parsed[1]}`, answer: factProduct(parsed), isUnknown: false, fact: parsed });
      } else {
        // No mastered facts yet (rare edge case in Level A); repeat unknown
        sequence.push({ display: unknownDisplay, answer: unknownAnswer, isUnknown: true, fact: unknown });
      }
    }
  }

  return sequence;
}

/* ─────────────────────────────────────────────
   LEVEL TEST FACTS
   1-minute test: current level facts + all mastered previous facts.
   Returns a large shuffled pool (auto-cycles as needed).
───────────────────────────────────────────── */
function buildLevelTestFacts(currentLevelKey, masteredFactKeys) {
  const currentLevelFacts = LEVEL_MAP[currentLevelKey].facts;
  const masteredFacts = masteredFactKeys.map(k => parseFactKey(k));

  const pool = [...currentLevelFacts, ...masteredFacts];
  shuffle(pool);

  // Expand to ~120 by cycling
  const expanded = [];
  while (expanded.length < 120) {
    expanded.push(...pool.map(f => ({
      display: `${f[0]} × ${f[1]}`,
      answer: factProduct(f),
      fact: f,
    })));
  }
  shuffle(expanded);
  return expanded.slice(0, 120);
}

/* ─────────────────────────────────────────────
   DIAGNOSTIC FACTS
   Random sample from a range of levels.  Returns ~120 shuffled facts.
───────────────────────────────────────────── */
function buildDiagnosticFacts(startKey, endKey) {
  const facts = getFactsInRange(startKey, endKey);
  if (facts.length === 0) return [];

  const expanded = [];
  while (expanded.length < 120) {
    expanded.push(...facts.map(f => ({
      display: `${f[0]} × ${f[1]}`,
      answer: factProduct(f),
      fact: f,
    })));
  }
  shuffle(expanded);
  return expanded.slice(0, 120);
}

/* ─────────────────────────────────────────────
   BASELINE FACTS
   Random mix from ALL levels.  Returns ~240 shuffled facts (2-min test).
───────────────────────────────────────────── */
function buildBaselineFacts() {
  const facts = getAllFacts();
  const expanded = [];
  while (expanded.length < 240) {
    expanded.push(...facts.map(f => ({
      display: `${f[0]} × ${f[1]}`,
      answer: factProduct(f),
      fact: f,
    })));
  }
  shuffle(expanded);
  return expanded.slice(0, 240);
}

/* ─────────────────────────────────────────────
   BINARY SEARCH DIAGNOSTIC STATE MACHINE

   State held by the caller (app.js); these are pure helper functions.
   Returns: { nextStart, nextEnd, done, placementLevel }
───────────────────────────────────────────── */

/**
 * Given current diagnostic range and whether the student PASSED (>=40),
 * return the next range to test, or a placement level if search is done.
 *
 * @param {string}  startKey  e.g. 'A'
 * @param {string}  endKey    e.g. 'M'
 * @param {boolean} passed    student DCPM >= 40
 * @returns {{ done: boolean, placementLevel?: string, nextStart?: string, nextEnd?: string }}
 */
function advanceDiagnostic(startKey, endKey, passed) {
  const startIdx = LEVEL_ORDER.indexOf(startKey);
  const endIdx   = LEVEL_ORDER.indexOf(endKey);

  // Single level left → placement found
  if (startIdx === endIdx) {
    // If they passed this single level, they go to the next level above
    // (they have no gap in this range).  If no next, place at startKey.
    if (passed) {
      const nextIdx = endIdx + 1;
      if (nextIdx < LEVEL_ORDER.length) {
        return { done: true, placementLevel: LEVEL_ORDER[nextIdx] };
      }
      // Passed everything — should not normally reach here (baseline catches high fluency)
      return { done: true, placementLevel: LEVEL_ORDER[endIdx] };
    } else {
      return { done: true, placementLevel: startKey };
    }
  }

  const midIdx = Math.floor((startIdx + endIdx) / 2);

  if (!passed) {
    // Gap in first half [start .. mid]
    const newEnd = LEVEL_ORDER[midIdx];
    return { done: false, nextStart: startKey, nextEnd: newEnd };
  } else {
    // Gap in second half [mid+1 .. end]
    const newStart = LEVEL_ORDER[midIdx + 1];
    return { done: false, nextStart: newStart, nextEnd: endKey };
  }
}
