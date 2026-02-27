/**
 * ui/display.js
 * Visual Feedback and Screen Transitions
 *
 * Handles:
 *  • Showing/hiding named screens
 *  • Rendering the current problem (fact display)
 *  • Showing the student's typed answer digits
 *  • Feedback messages (correct / incorrect / correction prompt)
 *  • Progress bar updates
 *  • Level and phase labels
 *  • Stats/score displays
 */

window.UI = window.UI || {};

window.UI.Display = (function () {

  // ── Screen management ──────────────────────────────────────────────────────
  // All screens share the class 'screen'; only one is visible at a time.

  function showScreen(screenId) {
    var screens = document.querySelectorAll('.screen');
    screens.forEach(function (s) { s.classList.add('hidden'); });
    var target = document.getElementById(screenId);
    if (target) target.classList.remove('hidden');
  }

  // ── Problem display ────────────────────────────────────────────────────────
  // Renders the multiplication fact as "a × b = ?"
  // @param {Element} el   – the container element
  // @param {number}  a, b – the two factors
  function renderProblem(el, a, b) {
    if (!el) return;
    el.innerHTML =
      '<span class="factor">' + a + '</span>' +
      '<span class="operator"> &times; </span>' +
      '<span class="factor">' + b + '</span>' +
      '<span class="equals"> = </span>' +
      '<span class="blank">?</span>';
  }

  // ── Answer input display ──────────────────────────────────────────────────
  // Shows the student's currently typed digits, or a cursor placeholder.
  function renderAnswerInput(el, typedDigits) {
    if (!el) return;
    if (!typedDigits || typedDigits.length === 0) {
      el.textContent = '_';
      el.classList.remove('has-input');
    } else {
      el.textContent = typedDigits;
      el.classList.add('has-input');
    }
  }

  // ── Feedback flash ────────────────────────────────────────────────────────
  // Briefly shows a feedback message then clears it.
  // @param {Element} el
  // @param {string}  message
  // @param {string}  type – 'correct' | 'incorrect' | 'info'
  // @param {number}  durationMs – 0 = persistent until clearFeedback()
  function showFeedback(el, message, type, durationMs) {
    if (!el) return;
    el.textContent = message;
    el.className   = 'feedback feedback--' + (type || 'info');
    el.classList.remove('hidden');

    if (durationMs && durationMs > 0) {
      setTimeout(function () {
        el.textContent = '';
        el.classList.add('hidden');
      }, durationMs);
    }
  }

  function clearFeedback(el) {
    if (!el) return;
    el.textContent = '';
    el.classList.add('hidden');
  }

  // ── Correction prompt ─────────────────────────────────────────────────────
  // Displays the error-correction instruction below the problem.
  function showCorrectionPrompt(el, correctAnswer) {
    if (!el) return;
    el.innerHTML =
      'The correct answer is <strong>' + correctAnswer + '</strong>. ' +
      'Type <strong>' + correctAnswer + '</strong> to continue.';
    el.classList.remove('hidden');
  }

  function hideCorrectionPrompt(el) {
    if (!el) return;
    el.innerHTML = '';
    el.classList.add('hidden');
  }

  // ── Progress bar ──────────────────────────────────────────────────────────
  // @param {Element} barEl    – the inner fill element
  // @param {Element} labelEl  – optional text label
  // @param {number}  pct      – 0–100
  function updateProgressBar(barEl, labelEl, pct) {
    if (barEl) {
      barEl.style.width = Math.min(100, Math.max(0, pct)) + '%';
    }
    if (labelEl) {
      labelEl.textContent = Math.round(pct) + '%';
    }
  }

  // ── IR step indicator ─────────────────────────────────────────────────────
  // Shows "Step 3 of 5" and card-type badge ("NEW" or "REVIEW").
  function updateIRIndicator(stepEl, typeEl, progress) {
    if (!progress) return;
    if (stepEl) {
      stepEl.textContent = 'Step ' + progress.step + ' of ' + progress.maxSteps;
    }
    if (typeEl) {
      if (progress.awaitingCorrection) {
        typeEl.textContent = 'CORRECTION';
        typeEl.className   = 'fact-type fact-type--correction';
      } else if (progress.cardIndex === 0) {
        typeEl.textContent = 'NEW';
        typeEl.className   = 'fact-type fact-type--new';
      } else {
        typeEl.textContent = 'REVIEW';
        typeEl.className   = 'fact-type fact-type--review';
      }
    }
  }

  // ── Level label ──────────────────────────────────────────────────────────
  function setLevelLabel(el, levelKey) {
    if (!el) return;
    el.textContent = 'Level ' + levelKey;
  }

  // ── Phase label ──────────────────────────────────────────────────────────
  function setPhaseLabel(el, phase) {
    if (!el) return;
    var labels = {
      BASELINE:   'Baseline Assessment',
      PRACTICE:   'Practice',
      LEVEL_TEST: 'Level Test',
      COMPLETE:   'Complete'
    };
    el.textContent = labels[phase] || phase;
  }

  // ── DCPM display ─────────────────────────────────────────────────────────
  function setDCPM(el, dcpm) {
    if (!el) return;
    el.textContent = dcpm !== null ? 'DCPM: ' + dcpm : '';
  }

  // ── Stats block ───────────────────────────────────────────────────────────
  // Renders a stats summary into a container element.
  function renderStats(el, stats) {
    if (!el || !stats) return;
    var html = '<table class="stats-table">';
    if (stats.baselineDCPM !== null && stats.baselineDCPM !== undefined) {
      html += '<tr><td>Baseline DCPM</td><td>' + stats.baselineDCPM + '</td></tr>';
    }
    if (stats.latestDCPM !== null && stats.latestDCPM !== undefined) {
      html += '<tr><td>Latest DCPM</td><td>' + stats.latestDCPM + '</td></tr>';
    }
    html += '<tr><td>Facts Mastered</td><td>' + stats.masteredFactCount + '</td></tr>';
    html += '<tr><td>Levels Passed</td><td>' + stats.passedLevelCount + '</td></tr>';
    html += '</table>';
    el.innerHTML = html;
  }

  // ── Welcome screen setup ──────────────────────────────────────────────────
  function showResumeInfo(el, levelKey, phase) {
    if (!el) return;
    el.textContent = 'Resuming at Level ' + levelKey + ' — ' + phase;
    el.classList.remove('hidden');
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  return {
    showScreen:           showScreen,
    renderProblem:        renderProblem,
    renderAnswerInput:    renderAnswerInput,
    showFeedback:         showFeedback,
    clearFeedback:        clearFeedback,
    showCorrectionPrompt: showCorrectionPrompt,
    hideCorrectionPrompt: hideCorrectionPrompt,
    updateProgressBar:    updateProgressBar,
    updateIRIndicator:    updateIRIndicator,
    setLevelLabel:        setLevelLabel,
    setPhaseLabel:        setPhaseLabel,
    setDCPM:              setDCPM,
    renderStats:          renderStats,
    showResumeInfo:       showResumeInfo
  };

})();
