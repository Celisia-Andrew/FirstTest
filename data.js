/* ═══════════════════════════════════════════════════════════════════════
   data.js — Level Map, fact utilities, and localStorage persistence.

   Future expansion notes:
   - OPERATION can be set to 'addition' | 'subtraction' | 'division'
     when those modules are built. All downstream code reads LEVEL_MAP
     dynamically, so adding new operations means only extending this file
     and the corresponding UI labels.
   - studentData shape is documented below; keep it stable so the future
     Teacher Dashboard can aggregate across many students without migration.
════════════════════════════════════════════════════════════════════════ */

'use strict';

/* ─────────────────────────────────────────────
   LEVEL MAP  (A → Z)
   Each entry: { facts: [[a, b], ...], commutative: bool }
   commutative:true → A and F only; both a×b and b×a are included.
   All other levels are NON-COMMUTATIVE: presented exactly as listed.
───────────────────────────────────────────── */
const LEVEL_MAP = (() => {
  // Helper: generate commutative pairs for n×k and k×n where n = 0..10
  function commutativePairs(fixedFactor) {
    const pairs = [];
    for (let n = 0; n <= 10; n++) {
      pairs.push([n, fixedFactor]);
      if (n !== fixedFactor) pairs.push([fixedFactor, n]);
    }
    // dedupe (n === fixedFactor gives duplicate when n == fixedFactor)
    const seen = new Set();
    return pairs.filter(([a, b]) => {
      const key = `${a}x${b}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  return {
    A: { facts: commutativePairs(1), commutative: true },
    B: { facts: [[5,2],[5,3],[5,4],[5,5]], commutative: false },
    C: { facts: [[2,2],[3,2],[4,2],[5,2]], commutative: false },
    D: { facts: [[2,5],[3,5],[4,5],[5,5]], commutative: false },
    E: { facts: [[2,2],[2,3],[2,4],[2,5]], commutative: false },
    F: { facts: commutativePairs(0), commutative: true },
    G: { facts: [[5,6],[5,7],[5,8],[5,9]], commutative: false },
    H: { facts: [[2,6],[2,7],[2,8],[2,9]], commutative: false },
    I: { facts: [[6,5],[7,5],[8,5],[9,5]], commutative: false },
    J: { facts: [[6,2],[7,2],[8,2],[9,2]], commutative: false },
    K: { facts: [[2,0],[3,0],[4,0],[5,0]], commutative: false },
    L: { facts: [[0,6],[0,7],[0,8],[0,9]], commutative: false },
    M: { facts: [[9,2],[9,3],[9,4],[9,5]], commutative: false },
    N: { facts: [[4,2],[4,3],[4,4],[4,5]], commutative: false },
    O: { facts: [[2,9],[3,9],[4,9],[5,9]], commutative: false },
    P: { facts: [[2,4],[3,4],[4,4],[5,4]], commutative: false },
    Q: { facts: [[9,6],[9,7],[9,8],[9,9]], commutative: false },
    R: { facts: [[4,6],[4,7],[4,8],[4,9]], commutative: false },
    S: { facts: [[6,9],[7,9],[8,9],[9,9]], commutative: false },
    T: { facts: [[6,4],[7,4],[8,4],[9,4]], commutative: false },
    U: { facts: [[3,6],[3,7],[3,8],[3,9]], commutative: false },
    V: { facts: [[6,6],[6,7],[6,8],[6,9]], commutative: false },
    W: { facts: [[6,3],[7,3],[8,3],[9,3]], commutative: false },
    X: { facts: [[7,6],[8,6],[9,6]],       commutative: false },
    Y: { facts: [[7,7],[8,7],[9,7]],       commutative: false },
    Z: { facts: [[7,8],[8,8],[9,8]],       commutative: false },
  };
})();

/* Ordered level keys for sequential progression */
const LEVEL_ORDER = Object.keys(LEVEL_MAP); // ['A','B','C',...,'Z']

/* ─────────────────────────────────────────────
   FACT UTILITIES
───────────────────────────────────────────── */

/** Returns the product of a fact [a, b] */
function factProduct([a, b]) { return a * b; }

/** Returns a string key for a fact */
function factKey([a, b]) { return `${a}x${b}`; }

/** Parse a factKey back to [a, b] */
function parseFactKey(key) {
  const [a, b] = key.split('x').map(Number);
  return [a, b];
}

/**
 * Count correct digits between two non-negative integer strings.
 * Aligns from the RIGHT (ones place) and compares digit-by-digit.
 * Example: correct=144, student=145 → 2 correct digits.
 */
function countCorrectDigits(correctVal, studentVal) {
  const correct = String(correctVal);
  const student = String(studentVal);
  let count = 0;
  // Compare from the end (rightmost digit = ones place)
  for (let i = 1; i <= Math.min(correct.length, student.length); i++) {
    if (correct[correct.length - i] === student[student.length - i]) {
      count++;
    } else {
      break; // stop at first mismatch from the right
    }
  }
  return count;
}

/**
 * Returns all facts across ALL levels as a flat array of [a, b].
 * Used for baseline test.
 */
function getAllFacts() {
  const all = [];
  for (const level of LEVEL_ORDER) {
    for (const fact of LEVEL_MAP[level].facts) {
      all.push(fact);
    }
  }
  return all;
}

/**
 * Returns all facts up to and including a given level (inclusive).
 * Used for level tests and diagnostic sampling.
 */
function getFactsUpToLevel(levelKey) {
  const facts = [];
  for (const lk of LEVEL_ORDER) {
    for (const fact of LEVEL_MAP[lk].facts) {
      facts.push(fact);
    }
    if (lk === levelKey) break;
  }
  return facts;
}

/**
 * Returns facts within a range of levels [startKey, endKey] inclusive.
 */
function getFactsInRange(startKey, endKey) {
  const facts = [];
  let inRange = false;
  for (const lk of LEVEL_ORDER) {
    if (lk === startKey) inRange = true;
    if (inRange) {
      for (const fact of LEVEL_MAP[lk].facts) {
        facts.push(fact);
      }
    }
    if (lk === endKey) break;
  }
  return facts;
}

/** Shallow-shuffle an array in place (Fisher-Yates) */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Pick n random elements from arr (no repeats, arr unchanged) */
function sample(arr, n) {
  const copy = arr.slice();
  shuffle(copy);
  return copy.slice(0, n);
}

/* ─────────────────────────────────────────────
   ADDITION / SUBTRACTION FACTS FOR LEVEL A
   Used as "previously known" knowns when practicing Level A.
───────────────────────────────────────────── */
const LEVEL_A_ADDITION_KNOWNS = [
  { display: '1 + 1', answer: 2 },
  { display: '2 + 1', answer: 3 },
  { display: '1 + 2', answer: 3 },
  { display: '1 + 4', answer: 5 },
  { display: '4 + 1', answer: 5 },
  { display: '5 + 2', answer: 7 },
  { display: '1 − 1', answer: 0 },
  { display: '2 − 1', answer: 1 },
  { display: '4 − 1', answer: 3 },
];

/* ─────────────────────────────────────────────
   STUDENT DATA  (localStorage persistence)

   Shape:
   {
     version: 1,                       // schema version for future migrations
     currentLevel: 'A',                // active level key
     currentFactIndex: 0,              // index within current level's facts
     masteredFacts: ['0x1','1x0',...], // factKeys of fully mastered facts
     masteredLevels: ['A', 'B'],       // fully completed levels
     diagnosticHistory: [              // TODO: expose to Teacher Dashboard
       { date, rangeStart, rangeEnd, dcpm }
     ],
     dcpmHistory: [                    // TODO: expose to Teacher Dashboard
       { date, context, dcpm }         // context = 'baseline'|'diagnostic'|'practice'|'level-test'
     ],
     activeTimeMs: 0,                  // cumulative ms on task (for Teacher Dashboard)
     sessionStartMs: null,             // set on session start, cleared on session end
   }
───────────────────────────────────────────── */
const STORAGE_KEY = 'mf_student_data';
const DATA_VERSION = 1;

function defaultStudentData() {
  return {
    version: DATA_VERSION,
    currentLevel: 'A',
    currentFactIndex: 0,
    masteredFacts: [],
    masteredLevels: [],
    diagnosticHistory: [],
    dcpmHistory: [],
    activeTimeMs: 0,
    sessionStartMs: null,
  };
}

function loadStudentData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultStudentData();
    const data = JSON.parse(raw);
    // Basic version guard (future: run migrations here)
    if (!data.version || data.version < DATA_VERSION) return defaultStudentData();
    return data;
  } catch (_) {
    return defaultStudentData();
  }
}

function saveStudentData(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (_) {
    // Quota exceeded or private mode — silent fail; data lives in memory only
  }
}

function resetStudentData() {
  localStorage.removeItem(STORAGE_KEY);
  return defaultStudentData();
}

/* Convenience: record a DCPM result */
function recordDCPM(data, context, dcpm) {
  data.dcpmHistory.push({
    date: new Date().toISOString(),
    context,
    dcpm: Math.round(dcpm * 10) / 10,
  });
  saveStudentData(data);
}

/* Convenience: accumulate active time */
function endSession(data) {
  if (data.sessionStartMs) {
    data.activeTimeMs += Date.now() - data.sessionStartMs;
    data.sessionStartMs = null;
    saveStudentData(data);
  }
}
