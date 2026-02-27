/**
 * ui/timer.js
 * Countdown Timer for Timed Assessments
 *
 * Manages countdown display and fires a callback when time expires.
 * The timer is used during:
 *   • Phase 1: Baseline Assessment (2 minutes)
 *   • Phase 3: Level Progression Test (1 minute)
 *
 * The engine does NOT depend on this module.
 */

window.UI = window.UI || {};

window.UI.Timer = (function () {

  var _intervalId    = null;   // setInterval handle
  var _remaining     = 0;      // seconds remaining
  var _onTick        = null;   // callback(secondsRemaining) — called each second
  var _onExpire      = null;   // callback() — called when timer reaches 0
  var _displayEl     = null;   // DOM element to update each tick
  var _warningThresh = 30;     // seconds below which the display turns red

  // ── start ─────────────────────────────────────────────────────────────────
  // @param {number}   durationSeconds
  // @param {Element}  displayElement  – DOM element whose textContent is updated
  // @param {Function} onTick          – optional; called with (secondsRemaining)
  // @param {Function} onExpire        – called when timer hits 0
  function start(durationSeconds, displayElement, onTick, onExpire) {
    stop(); // clear any existing timer

    _remaining = durationSeconds;
    _displayEl = displayElement;
    _onTick    = onTick   || null;
    _onExpire  = onExpire || null;

    _render();

    _intervalId = setInterval(function () {
      _remaining--;

      if (_remaining <= 0) {
        _remaining = 0;
        _render();
        stop();
        if (_onExpire) _onExpire();
      } else {
        _render();
        if (_onTick) _onTick(_remaining);
      }
    }, 1000);
  }

  // ── stop ──────────────────────────────────────────────────────────────────
  function stop() {
    if (_intervalId !== null) {
      clearInterval(_intervalId);
      _intervalId = null;
    }
  }

  // ── getRemainingSeconds ───────────────────────────────────────────────────
  function getRemainingSeconds() {
    return _remaining;
  }

  // ── isRunning ─────────────────────────────────────────────────────────────
  function isRunning() {
    return _intervalId !== null;
  }

  // ── _render ───────────────────────────────────────────────────────────────
  // Updates the display element with MM:SS format.
  function _render() {
    if (!_displayEl) return;

    var mins = Math.floor(_remaining / 60);
    var secs = _remaining % 60;
    var display = mins + ':' + (secs < 10 ? '0' : '') + secs;

    _displayEl.textContent = display;

    // Visual urgency: turn red when time is low
    if (_remaining <= _warningThresh) {
      _displayEl.classList.add('timer--warning');
    } else {
      _displayEl.classList.remove('timer--warning');
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  return {
    start:               start,
    stop:                stop,
    getRemainingSeconds: getRemainingSeconds,
    isRunning:           isRunning
  };

})();
