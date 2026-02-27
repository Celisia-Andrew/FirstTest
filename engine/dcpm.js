/**
 * engine/dcpm.js
 * Digit-Based Scoring — Digits Correct Per Minute (DCPM)
 *
 * DCPM is used ONLY during timed assessments (Phase 1 Baseline and
 * Phase 3 Level Progression Tests). It is NOT used during IR practice.
 *
 * Formula:
 *   DCPM = (Total Correct Digits / Elapsed Seconds) × 60
 *
 * Digit Credit Rules:
 *   – Compare the student's answer to the correct answer digit-by-digit,
 *     left to right, for exactly correct.length positions.
 *   – Each matching digit at the same position earns 1 digit credit.
 *   – Extra digits typed beyond the correct answer length earn no credit.
 *
 * Examples:
 *   correct = 81, student = 83  →  '8'='8' ✓, '1'≠'3' ✗  → 1 digit
 *   correct = 81, student = 81  →  '8'='8' ✓, '1'='1' ✓  → 2 digits
 *   correct = 6,  student = 6   →  '6'='6' ✓              → 1 digit
 *   correct = 144, student = 140 → '1'='1'✓,'4'='4'✓,'4'≠'0'✗ → 2 digits
 */

window.Engine = window.Engine || {};

window.Engine.DCPM = (function () {

  // ── countCorrectDigits ─────────────────────────────────────────────────────
  // Returns how many digits the student answered correctly, left to right.
  // @param {number} correctAnswer  – the mathematically correct product
  // @param {string|number} studentAnswer – what the student typed
  function countCorrectDigits(correctAnswer, studentAnswer) {
    var correct = String(correctAnswer);
    var student = String(studentAnswer);

    var count = 0;
    // Compare only up to the length of the correct answer;
    // positions beyond that earn no credit even if student typed more.
    for (var i = 0; i < correct.length; i++) {
      if (i < student.length && correct[i] === student[i]) {
        count++;
      }
    }
    return count;
  }

  // ── calculateDCPM ──────────────────────────────────────────────────────────
  // Computes the final DCPM score from a completed assessment session.
  //
  // @param {Array}  responses – array of response objects, each with:
  //                   { correctAnswer, studentAnswer }
  // @param {number} elapsedSeconds – total seconds the assessment ran
  //                   (120 for baseline, 60 for level test)
  // @returns {number} DCPM rounded to one decimal place
  function calculateDCPM(responses, elapsedSeconds) {
    if (!responses || responses.length === 0 || elapsedSeconds <= 0) {
      return 0;
    }

    var totalCorrectDigits = 0;
    for (var i = 0; i < responses.length; i++) {
      var r = responses[i];
      // Only count responses where a student answer was actually submitted
      if (r.studentAnswer !== null && r.studentAnswer !== undefined && r.studentAnswer !== '') {
        totalCorrectDigits += countCorrectDigits(r.correctAnswer, r.studentAnswer);
      }
    }

    var dcpm = (totalCorrectDigits / elapsedSeconds) * 60;
    return Math.round(dcpm * 10) / 10; // round to 1 decimal
  }

  // ── getAnswerDigitLength ───────────────────────────────────────────────────
  // Returns how many digits are in the correct answer for a given fact [a, b].
  // Used by the input module to determine when to auto-advance.
  function getAnswerDigitLength(a, b) {
    return String(a * b).length;
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  return {
    countCorrectDigits: countCorrectDigits,
    calculateDCPM: calculateDCPM,
    getAnswerDigitLength: getAnswerDigitLength
  };

})();
