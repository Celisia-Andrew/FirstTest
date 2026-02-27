/**
 * ui/input.js
 * Keyboard Input Handling
 *
 * Captures digit key presses and implements the auto-advance rule:
 *   "Auto-advance when the number of typed digits equals the length
 *    of the correct answer." (Spec §3B — Timed Assessment Mode)
 *
 * The same auto-advance logic is applied to IR practice for consistency.
 *
 * ── How it works ─────────────────────────────────────────────────────────────
 *  1. Call UI.Input.activate(config) to start listening.
 *  2. The user types digits; each keystroke updates the typed buffer.
 *  3. When buffer.length === expectedDigits, onSubmit(buffer) is fired.
 *  4. Call UI.Input.deactivate() to stop listening (e.g. between problems).
 *
 * ── Backspace ─────────────────────────────────────────────────────────────
 *  Backspace removes the last digit (prevented during active correction
 *  prompts to avoid confusion, but allowed during normal problem solving).
 *
 * ── No Enter / Submit needed ─────────────────────────────────────────────
 *  All submission is purely digit-count triggered (spec requirement).
 */

window.UI = window.UI || {};

window.UI.Input = (function () {

  var _active         = false;
  var _buffer         = '';          // digits typed so far
  var _expectedDigits = 0;           // length of correct answer
  var _onDigit        = null;        // callback(buffer) — called on each digit
  var _onSubmit       = null;        // callback(buffer) — called on auto-advance
  var _allowBackspace = true;

  // ── activate ──────────────────────────────────────────────────────────────
  // Begin capturing input for a new problem.
  //
  // @param {Object} config
  //   config.expectedDigits  {number}   – digit count that triggers auto-submit
  //   config.onDigit         {Function} – called(buffer) after each digit typed
  //   config.onSubmit        {Function} – called(buffer) on auto-advance
  //   config.allowBackspace  {boolean}  – default true
  function activate(config) {
    _buffer         = '';
    _expectedDigits = config.expectedDigits || 1;
    _onDigit        = config.onDigit  || null;
    _onSubmit       = config.onSubmit || null;
    _allowBackspace = (config.allowBackspace !== false);
    _active         = true;
  }

  // ── deactivate ────────────────────────────────────────────────────────────
  // Stop accepting input (call between problems or on screen transitions).
  function deactivate() {
    _active = false;
    _buffer = '';
  }

  // ── getBuffer ─────────────────────────────────────────────────────────────
  function getBuffer() { return _buffer; }

  // ── clearBuffer ───────────────────────────────────────────────────────────
  function clearBuffer() {
    _buffer = '';
    if (_onDigit) _onDigit(_buffer);
  }

  // ── _handleKey ───────────────────────────────────────────────────────────
  // Global keydown handler (attached once in init).
  function _handleKey(e) {
    if (!_active) return;

    var key = e.key;

    // ── Digit key ───────────────────────────────────────────────────────
    if (/^[0-9]$/.test(key)) {
      // Don't overshoot the expected length — guard against fast typing
      if (_buffer.length >= _expectedDigits) return;

      e.preventDefault();
      _buffer += key;

      if (_onDigit) _onDigit(_buffer);

      // Auto-advance when buffer reaches the expected answer length
      if (_buffer.length >= _expectedDigits) {
        var submitted = _buffer;
        deactivate();
        if (_onSubmit) _onSubmit(submitted);
      }
      return;
    }

    // ── Backspace ───────────────────────────────────────────────────────
    if (key === 'Backspace' && _allowBackspace) {
      e.preventDefault();
      if (_buffer.length > 0) {
        _buffer = _buffer.slice(0, -1);
        if (_onDigit) _onDigit(_buffer);
      }
    }
  }

  // ── init ──────────────────────────────────────────────────────────────────
  // Attach the global keydown listener once at app startup.
  // Also handles the Ctrl+Alt+R teacher-reset shortcut.
  function init(onTeacherReset) {
    document.addEventListener('keydown', function (e) {
      // Teacher reset shortcut: Ctrl + Alt + R
      if (e.ctrlKey && e.altKey && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        if (onTeacherReset) onTeacherReset();
        return;
      }
      _handleKey(e);
    });
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  return {
    init:        init,
    activate:    activate,
    deactivate:  deactivate,
    getBuffer:   getBuffer,
    clearBuffer: clearBuffer
  };

})();
