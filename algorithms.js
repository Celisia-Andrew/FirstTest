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
   SESSION BANK BUILDER  (#1 — 4-Tier Hierarchical Selection)

   Selects exactly 9 (or fewer if pool is small) known cards for a U1 cycle.

   Tier priority (strictly ordered, no overlap):
     T1 — Commutative match: fact[0]===U1[1] && fact[1]===U1[0]
     T2 — First-factor anchor: fact[0]===U1[0]  (not already in T1)
     T3 — Remaining shared: fact[0]===U1[1] || fact[1]===U1[1] || fact[1]===U1[0]
     T4 — No shared factors: all others

   Special cases:
   - Level A unknowns: no prior multiplication facts → use addition/subtraction facts.
   - Level F unknowns: pool is A-E mastered facts.

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

  // All other levels: 4-tier hierarchical selection from knownPool
  if (knownPool.length === 0) {
    return LEVEL_A_ADDITION_KNOWNS.slice(0, TARGET).map(k => ({
      display: k.display, answer: k.answer, isUnknown: false, fact: null,
    }));
  }

  const [ua, ub] = unknown;
  const tier1 = [], tier2 = [], tier3 = [], tier4 = [];

  for (const fact of knownPool) {
    const [a, b] = fact;
    if (a === ub && b === ua) {
      // T1: commutative match (both factors swapped)
      tier1.push(fact);
    } else if (a === ua) {
      // T2: first-factor anchor
      tier2.push(fact);
    } else if (a === ub || b === ub || b === ua) {
      // T3: any remaining shared factor
      tier3.push(fact);
    } else {
      // T4: no shared factors
      tier4.push(fact);
    }
  }

  console.log(
    `Target: [${ua}×${ub}], ` +
    `Tier1: ${tier1.length}, Tier2: ${tier2.length}, ` +
    `Tier3: ${tier3.length}, Tier4: ${tier4.length}, ` +
    `Total pool: ${knownPool.length}`
  );

  const selected = [];
  for (const tier of [tier1, tier2, tier3, tier4]) {
    if (selected.length >= TARGET) break;
    const picks = sample(tier, Math.min(tier.length, TARGET - selected.length));
    selected.push(...picks);
  }

  return selected.map(fact => ({
    display:   `${fact[0]} × ${fact[1]}`,
    answer:    factProduct(fact),
    isUnknown: false,
    fact,
  }));
}

/* ─────────────────────────────────────────────
   IR SEQUENCE GENERATOR  (#1 — 55-card Shuffled Folding-In)

   Always produces exactly 10 steps = 1+2+3+…+10 = 55 total cards.
   Step 0: [U]
   Step 1: [U, K×1]
   Step 2: [U, K×2]
   …
   Step 9: [U, K×9]

   No-back-to-back repeats for Known cards (U1 may appear consecutively
   as it leads every step).

   @param {[number,number]} unknown      Target fact [a,b]
   @param {Array}           sessionBank  Up to 9-fact bank from buildSessionBank()
   @returns {Array<{display, answer, isUnknown, fact}>}  55 cards
───────────────────────────────────────────── */
function generateIRSequence(unknown, sessionBank) {
  const unknownCard = {
    display:   `${unknown[0]} × ${unknown[1]}`,
    answer:    factProduct(unknown),
    isUnknown: true,
    fact:      unknown,
  };

  // Pad bank to 9 entries if smaller (repeat from bank cyclically)
  const bank = sessionBank.slice();
  while (bank.length < 9 && bank.length > 0) {
    bank.push(...sessionBank.slice(0, 9 - bank.length));
  }

  const sequence = [];

  for (let i = 0; i < 10; i++) {
    // Lead each step with U1
    sequence.push({ ...unknownCard });

    if (i === 0) continue; // Step 0 is just [U]

    // Pick i unique Knowns from bank, then apply no-back-to-back guard
    const picked = sample(bank, Math.min(i, bank.length));

    // No-back-to-back guard: the card just pushed is U1 (isUnknown=true),
    // so we only need to guard between consecutive Knowns in picked.
    for (let k = 0; k < picked.length; k++) {
      if (k > 0 && picked[k].display === picked[k - 1].display) {
        // Swap with a later card to break the repeat
        for (let j = k + 1; j < picked.length; j++) {
          if (picked[j].display !== picked[k - 1].display) {
            [picked[k], picked[j]] = [picked[j], picked[k]];
            break;
          }
        }
      }
      sequence.push({ ...picked[k] });
    }
  }

  return sequence; // exactly 55 cards (10 + 9×5 = no; 1+2+…+10 = 55)
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
  const levelFacts   = LEVEL_MAP[levelKey].facts;
  const rotatingPool = shuffle(levelFacts.slice());  // random rotation order
  let   poolIdx      = 0;

  function nextUnknownCard() {
    const f = rotatingPool[poolIdx % rotatingPool.length];
    poolIdx++;
    return { display: `${f[0]} × ${f[1]}`, answer: factProduct(f), isUnknown: true, fact: f };
  }

  // Pad bank to 9 if needed
  const bank = sessionBank.slice();
  while (bank.length < 9 && bank.length > 0) {
    bank.push(...sessionBank.slice(0, 9 - bank.length));
  }

  const sequence = [];

  for (let i = 0; i < 10; i++) {
    sequence.push(nextUnknownCard());
    if (i === 0) continue;

    const picked = sample(bank, Math.min(i, bank.length));
    for (let k = 0; k < picked.length; k++) {
      if (k > 0 && picked[k].display === picked[k - 1].display) {
        for (let j = k + 1; j < picked.length; j++) {
          if (picked[j].display !== picked[k - 1].display) {
            [picked[k], picked[j]] = [picked[j], picked[k]];
            break;
          }
        }
      }
      sequence.push({ ...picked[k] });
    }
  }

  return sequence;
}

/* ─────────────────────────────────────────────
   MASTERY CHECK SEQUENCE  (#4 — 80/20 maintenance distribution)

   Structure (120 slots):
     Position 0:  mandatory U1
     Position 9:  mandatory U1
     Every 5th non-U1 slot: draw from Recent Pool (U1 + last 3 mastered)
     All other non-U1 slots: draw from General Pool (remaining mastered)

   Recent Pool  = {U1} ∪ {last 3 mastered facts} (excluding U1)
   General Pool = all mastered facts not in Recent Pool
   Fallback: if General Pool < 10, collapse to single pool.

   U1 appears at mandatory positions plus random intervals of 5–10 problems.
───────────────────────────────────────────── */
function buildMasteryCheckSequence(unknown, allMasteredFacts) {
  const MAX_PROBLEMS = 120;
  const sequence     = [];

  const unknownDisplay = `${unknown[0]} × ${unknown[1]}`;
  const unknownAnswer  = factProduct(unknown);
  const unknownKey     = factKey(unknown);

  const unknownCard = {
    display: unknownDisplay, answer: unknownAnswer, isUnknown: true, fact: unknown,
  };

  // Build Recent Pool: U1 + last 3 mastered (excluding U1 itself)
  const masteredExcluding = allMasteredFacts.filter(f => {
    const arr = Array.isArray(f) ? f : parseFactKey(f);
    return factKey(arr) !== unknownKey;
  });
  const last3 = masteredExcluding.slice(-3);
  const recentKeys = new Set(last3.map(f => {
    const arr = Array.isArray(f) ? f : parseFactKey(f);
    return factKey(arr);
  }));

  const generalPool = masteredExcluding.filter(f => {
    const arr = Array.isArray(f) ? f : parseFactKey(f);
    return !recentKeys.has(factKey(arr));
  });
  const recentPool  = last3; // already arrays from masteredExcluding

  const useCollapsed = generalPool.length < 10;

  function pickRecent() {
    if (recentPool.length === 0) return null;
    const f = recentPool[Math.floor(Math.random() * recentPool.length)];
    const arr = Array.isArray(f) ? f : parseFactKey(f);
    return { display: `${arr[0]} × ${arr[1]}`, answer: factProduct(arr), isUnknown: false, fact: arr };
  }

  function pickGeneral() {
    const pool = useCollapsed ? masteredExcluding : generalPool;
    if (pool.length === 0) return null;
    const f = pool[Math.floor(Math.random() * pool.length)];
    const arr = Array.isArray(f) ? f : parseFactKey(f);
    return { display: `${arr[0]} × ${arr[1]}`, answer: factProduct(arr), isUnknown: false, fact: arr };
  }

  let nextUnknownAt = 5 + Math.floor(Math.random() * 6);
  let recentCounter = 0; // counts non-U1 slots; every 5th uses Recent

  for (let i = 0; i < MAX_PROBLEMS; i++) {
    // Mandatory U1 at positions 0 and 9
    if (i === 0 || i === 9 || i === nextUnknownAt) {
      sequence.push({ ...unknownCard });
      if (i === nextUnknownAt) {
        nextUnknownAt = i + 5 + Math.floor(Math.random() * 6);
      }
      continue;
    }

    // Non-U1 slot: 80/20 distribution
    recentCounter++;
    let card = null;
    if (recentCounter % 5 === 0) {
      card = pickRecent();
    }
    if (!card) {
      card = pickGeneral();
    }
    if (!card) {
      // No mastered facts at all → repeat unknown
      sequence.push({ ...unknownCard });
    } else {
      sequence.push(card);
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
