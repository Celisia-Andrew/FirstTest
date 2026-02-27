/**
 * ui/renderer.js
 * DOM Element Registry and Screen Initialisation
 *
 * Centralises all getElementById/querySelector calls so other modules
 * receive typed references rather than repeating DOM lookups.
 *
 * Call UI.Renderer.init() once at app startup (after DOMContentLoaded).
 */

window.UI = window.UI || {};

window.UI.Renderer = (function () {

  // All cached element references live here
  var els = {};

  // ── init ──────────────────────────────────────────────────────────────────
  // Populates the els registry. Safe to call multiple times.
  function init() {
    // ── Welcome screen ──────────────────────────────────────────────────
    els.screenWelcome       = document.getElementById('screen-welcome');
    els.btnStart            = document.getElementById('btn-start');
    els.resumeInfo          = document.getElementById('resume-info');

    // ── Assessment screen (Phase 1 Baseline & Phase 3 Level Test) ───────
    els.screenAssessment    = document.getElementById('screen-assessment');
    els.assessPhaseLabel    = document.getElementById('assess-phase-label');
    els.assessLevelLabel    = document.getElementById('assess-level-label');
    els.assessTimer         = document.getElementById('assess-timer');
    els.assessProblem       = document.getElementById('assess-problem');
    els.assessAnswer        = document.getElementById('assess-answer');
    els.assessDCPM          = document.getElementById('assess-dcpm');
    els.assessFactCount     = document.getElementById('assess-fact-count');

    // ── Placement screen (after baseline) ──────────────────────────────
    els.screenPlacement     = document.getElementById('screen-placement');
    els.placementDCPM       = document.getElementById('placement-dcpm');
    els.placementMessage    = document.getElementById('placement-message');
    els.btnPlacementNext    = document.getElementById('btn-placement-next');

    // ── Practice screen (Phase 2 IR) ────────────────────────────────────
    els.screenPractice      = document.getElementById('screen-practice');
    els.practLevelLabel     = document.getElementById('pract-level-label');
    els.practStepLabel      = document.getElementById('pract-step-label');
    els.practFactType       = document.getElementById('pract-fact-type');
    els.practProgressBar    = document.getElementById('pract-progress-bar');
    els.practProgressPct    = document.getElementById('pract-progress-pct');
    els.practProblem        = document.getElementById('pract-problem');
    els.practAnswer         = document.getElementById('pract-answer');
    els.practFeedback       = document.getElementById('pract-feedback');
    els.practCorrection     = document.getElementById('pract-correction');
    els.practTargetProgress = document.getElementById('pract-target-progress');

    // ── Level complete (all IR done, ready for level test) ──────────────
    els.screenLevelComplete = document.getElementById('screen-level-complete');
    els.levelCompleteTitle  = document.getElementById('level-complete-title');
    els.btnLevelTest        = document.getElementById('btn-level-test');

    // ── Level test result screen ─────────────────────────────────────────
    els.screenTestResult    = document.getElementById('screen-test-result');
    els.testResultTitle     = document.getElementById('test-result-title');
    els.testResultDCPM      = document.getElementById('test-result-dcpm');
    els.testResultMessage   = document.getElementById('test-result-message');
    els.btnTestResultNext   = document.getElementById('btn-test-result-next');

    // ── All levels complete screen ───────────────────────────────────────
    els.screenComplete      = document.getElementById('screen-complete');
    els.finalStats          = document.getElementById('final-stats');

    // ── Admin reset button (hidden) ──────────────────────────────────────
    els.adminReset          = document.getElementById('admin-reset');
  }

  // ── get ───────────────────────────────────────────────────────────────────
  // Returns a cached DOM element by key. Warns if not found.
  function get(key) {
    var el = els[key];
    if (!el) console.warn('[Renderer] Element not found for key: ' + key);
    return el || null;
  }

  // ── getAll ────────────────────────────────────────────────────────────────
  // Returns the full element map (read-only by convention).
  function getAll() { return els; }

  // ── Public API ─────────────────────────────────────────────────────────────
  return {
    init:   init,
    get:    get,
    getAll: getAll
  };

})();
