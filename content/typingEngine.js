// TypeStream - Typing Engine
// Handles keyboard input, word matching, prevents YouTube key shortcuts,
// and tracks typing stats.

(function(global) {
  'use strict';

  global.TypeStreamTypingEngine = class TypingEngine {
    constructor(options = {}) {
      this.currentInput = '';
      this.currentWord = '';
      this.isActive = false;
      this.isFocused = false;

      // Settings
      this.ignorePunctuation = options.ignorePunctuation !== false;
      this.ignoreCase = options.ignoreCase !== false;

      // Stats
      this.totalKeystrokes = 0;
      this.correctKeystrokes = 0;
      this.wordsCompleted = 0;
      this.sessionStartTime = null;
      this.keystrokeTimestamps = [];  // for rolling WPM
      this.recentCorrectKeystrokes = 0;
      this.recentKeystrokeWindow = 60000; // 60 second rolling window

      // YouTube keys to block when typing
      this.blockedKeys = new Set([
        ' ', 'Space', 'KeyK', 'KeyJ', 'KeyL', 'KeyF', 'KeyM',
        'KeyC', 'KeyT', 'Digit0', 'Digit1', 'Digit2', 'Digit3',
        'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9',
        'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
        'Home', 'End', 'PageUp', 'PageDown',
      ]);

      this._onKeyDown = this._onKeyDown.bind(this);
      this._callbacks = {};
    }

    on(event, fn) {
      this._callbacks[event] = fn;
    }

    _emit(event, data) {
      if (this._callbacks[event]) this._callbacks[event](data);
    }

    attach(containerEl) {
      this.containerEl = containerEl;
      this.isFocused = false;

      // Focus management: when user clicks the typing area or presses a key,
      // we intercept keyboard input globally.
      document.addEventListener('keydown', this._onKeyDown, true); // capture phase

      // Click-to-focus: clicking our shadow DOM panel activates typing
      if (containerEl) {
        containerEl.addEventListener('click', () => this.focus());
      }
    }

    detach() {
      document.removeEventListener('keydown', this._onKeyDown, true);
    }

    focus() {
      this.isFocused = true;
      this._emit('focusChange', { focused: true });
    }

    blur() {
      this.isFocused = false;
      this._emit('focusChange', { focused: false });
    }

    setWord(word) {
      this.currentWord = word || '';
      this.currentInput = '';
      this._emit('wordUpdate', {
        word: this.currentWord,
        input: this.currentInput,
        isComplete: false,
      });
    }

    startSession() {
      this.sessionStartTime = Date.now();
      this.totalKeystrokes = 0;
      this.correctKeystrokes = 0;
      this.wordsCompleted = 0;
      this.keystrokeTimestamps = [];
      this.recentCorrectKeystrokes = 0;
    }

    _onKeyDown(e) {
      if (!this.isFocused || !this.isActive) return;

      const key = e.key;
      const code = e.code;

      // Allow certain control keys
      const allowedControls = ['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
        'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'CapsLock', 'Tab'];

      if (allowedControls.includes(code)) return;

      // Block Escape to unfocus
      if (code === 'Escape') {
        this.blur();
        e.stopPropagation();
        e.preventDefault();
        return;
      }

      // Block YouTube shortcut keys
      if (this.blockedKeys.has(code) || this.blockedKeys.has(key)) {
        e.stopPropagation();
        e.preventDefault();
      }

      // Handle Backspace
      if (code === 'Backspace') {
        this.currentInput = this.currentInput.slice(0, -1);
        this.totalKeystrokes++;
        this._emit('wordUpdate', {
          word: this.currentWord,
          input: this.currentInput,
          isComplete: false,
          isBackspace: true,
        });
        return;
      }

      // Ignore non-printable keys
      if (key.length > 1) return;

      // Add character
      this.currentInput += key;
      this.totalKeystrokes++;

      // Check correctness
      const compareWord = this._normalize(this.currentWord);
      const compareInput = this._normalize(this.currentInput);

      const isCharCorrect = compareWord.startsWith(compareInput);
      if (isCharCorrect) {
        this.correctKeystrokes++;
        this._recordKeystroke(true);
      } else {
        this._recordKeystroke(false);
      }

      // Check if word is complete (input matches the full word)
      const isComplete = compareInput === compareWord;

      this._emit('wordUpdate', {
        word: this.currentWord,
        input: this.currentInput,
        isComplete,
        isCorrect: isCharCorrect,
      });

      if (isComplete) {
        this._onWordComplete();
      }
    }

    _onWordComplete() {
      this.wordsCompleted++;

      // Move to next word
      const newWord = this.currentWord; // will be overwritten by sync engine
      this.currentInput = '';
      this._emit('wordComplete', {
        word: newWord,
        wordsCompleted: this.wordsCompleted,
      });
    }

    _recordKeystroke(correct) {
      const now = Date.now();
      this.keystrokeTimestamps.push({ time: now, correct });

      // Prune old entries
      const cutoff = now - this.recentKeystrokeWindow;
      while (this.keystrokeTimestamps.length > 0 &&
             this.keystrokeTimestamps[0].time < cutoff) {
        this.keystrokeTimestamps.shift();
      }

      if (correct) {
        this.recentCorrectKeystrokes++;
      }
    }

    getWPM() {
      if (!this.sessionStartTime) return 0;

      const elapsed = (Date.now() - this.sessionStartTime) / 60000; // minutes
      if (elapsed < 0.01) return 0;

      // Standard: 5 characters = 1 word
      const grossWPM = (this.totalKeystrokes / 5) / elapsed;
      const errors = this.totalKeystrokes - this.correctKeystrokes;
      const netWPM = Math.max(0, grossWPM - (errors / elapsed));

      return Math.round(netWPM);
    }

    getRollingWPM() {
      // Rolling WPM based on last 60 seconds
      const now = Date.now();
      const cutoff = now - this.recentKeystrokeWindow;

      const recent = this.keystrokeTimestamps.filter(t => t.time >= cutoff);
      if (recent.length === 0) return 0;

      const totalChars = recent.length;
      const correctChars = recent.filter(t => t.correct).length;
      const timeSpan = Math.max(1, (now - (recent[0]?.time || now)));
      const mins = timeSpan / 60000;

      const grossWPM = (totalChars / 5) / mins;
      const errors = totalChars - correctChars;
      return Math.round(Math.max(0, grossWPM - (errors / mins)));
    }

    getAccuracy() {
      if (this.totalKeystrokes === 0) return 100;
      return Math.round((this.correctKeystrokes / this.totalKeystrokes) * 100);
    }

    getWordsDone() {
      return this.wordsCompleted;
    }

    getSessionTime() {
      if (!this.sessionStartTime) return 0;
      return Date.now() - this.sessionStartTime;
    }

    getStats() {
      return {
        wpm: this.getWPM(),
        rollingWpm: this.getRollingWPM(),
        accuracy: this.getAccuracy(),
        wordsDone: this.wordsCompleted,
        sessionTime: this.getSessionTime(),
        totalKeystrokes: this.totalKeystrokes,
        correctKeystrokes: this.correctKeystrokes,
      };
    }

    _normalize(str) {
      let s = str;
      if (this.ignoreCase) s = s.toLowerCase();
      if (this.ignorePunctuation) {
        s = s.replace(/[^\w\s]/g, '');
      }
      return s;
    }

    setOptions(opts) {
      if (opts.ignorePunctuation !== undefined) this.ignorePunctuation = opts.ignorePunctuation;
      if (opts.ignoreCase !== undefined) this.ignoreCase = opts.ignoreCase;
    }

    /**
     * Returns character-level diff for word highlighting.
     */
    getCharDiff() {
      const word = this.currentWord;
      const input = this.currentInput;
      const result = [];

      for (let i = 0; i < word.length; i++) {
        const expected = word[i];
        const actual = i < input.length ? input[i] : null;

        if (actual === null) {
          result.push({ char: expected, status: 'untyped' });
        } else {
          const match = this._charMatch(expected, actual);
          result.push({ char: expected, typed: actual, status: match ? 'correct' : 'incorrect' });
        }
      }

      return result;
    }

    _charMatch(expected, actual) {
      if (this.ignoreCase) {
        return expected.toLowerCase() === actual.toLowerCase();
      }
      return expected === actual;
    }
  };

})(typeof globalThis !== 'undefined' ? globalThis : window);
