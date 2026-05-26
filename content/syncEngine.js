// TypeStream - Sync Engine
// Manages video playback sync: pausing when user falls behind, seeking support,
// and mapping video currentTime to subtitle cue index.

(function(global) {
  'use strict';

  global.TypeStreamSyncEngine = class SyncEngine {
    constructor(options = {}) {
      this.video = null;
      this.cues = [];
      this.currentCueIndex = -1;
      this.currentWordIndex = 0;
      this.words = [];

      // Settings
      this.lagThreshold = options.lagThreshold || 5;          // words behind before auto-pause
      this.autoPauseEnabled = options.autoPauseEnabled !== false;
      this.strictMode = options.strictMode || false;
      this.flowTimeout = options.flowTimeout || 3000;          // ms before skip in flow mode

      this.isPausedByUs = false;
      this.isPlaying = false;
      this.flowSkipTimer = null;

      this._onTimeUpdate = this._onTimeUpdate.bind(this);
      this._onSeeked = this._onSeeked.bind(this);
      this._onPlay = this._onPlay.bind(this);
      this._onPause = this._onPause.bind(this);

      this._callbacks = {};
    }

    on(event, fn) {
      this._callbacks[event] = fn;
    }

    _emit(event, data) {
      if (this._callbacks[event]) this._callbacks[event](data);
    }

    attach(video, cues) {
      this.detach();
      this.video = video;
      this.cues = cues;
      this.currentCueIndex = -1;
      this.currentWordIndex = 0;
      this.words = [];
      this.isPausedByUs = false;

      if (!video) return;

      video.addEventListener('timeupdate', this._onTimeUpdate);
      video.addEventListener('seeked', this._onSeeked);
      video.addEventListener('play', this._onPlay);
      video.addEventListener('pause', this._onPause);

      // Initial sync
      this._syncToTime(video.currentTime);
    }

    detach() {
      if (this.video) {
        this.video.removeEventListener('timeupdate', this._onTimeUpdate);
        this.video.removeEventListener('seeked', this._onSeeked);
        this.video.removeEventListener('play', this._onPlay);
        this.video.removeEventListener('pause', this._onPause);
      }
      this.video = null;
      this.clearFlowTimer();
    }

    _onPlay() {
      this.isPlaying = true;
      if (this.isPausedByUs) {
        // User hit play manually; respect that
        this.isPausedByUs = false;
        this._resetWordPositionAtCurrentCue();
      }
    }

    _onPause() {
      this.isPlaying = false;
    }

    _onTimeUpdate() {
      this._syncToTime(this.video.currentTime);
    }

    _onSeeked() {
      this._syncToTime(this.video.currentTime, true);
    }

    /**
     * Main sync: find which cue corresponds to video time,
     * update words array, and check lag.
     */
    _syncToTime(timeSec, isSeek = false) {
      const timeMs = timeSec * 1000;
      let cueIndex = this._findCueIndex(timeMs);

      if (cueIndex !== this.currentCueIndex || isSeek) {
        this.currentCueIndex = cueIndex;
        this.currentWordIndex = 0;
        this._buildWords(cueIndex);
        this._emit('cueChange', { cueIndex, wordIndex: this.currentWordIndex, words: this.words });
      }

      this._checkLag();
    }

    _findCueIndex(timeMs) {
      for (let i = 0; i < this.cues.length; i++) {
        const cue = this.cues[i];
        if (timeMs >= cue.startMs && timeMs < cue.endMs) {
          return i;
        }
      }
      // Past all cues or before first
      if (this.cues.length > 0 && timeMs >= this.cues[this.cues.length - 1].endMs) {
        return this.cues.length - 1;
      }
      return -1;
    }

    _buildWords(cueIndex) {
      if (cueIndex < 0 || cueIndex >= this.cues.length) {
        this.words = [];
        this._emit('wordsReady', { words: [], cueIndex, snippetStart: cueIndex });
        return;
      }

      // Build words from current, next, and next+1 cues
      let snippetStart = cueIndex;
      let text = '';

      for (let i = cueIndex; i < Math.min(this.cues.length, cueIndex + 3); i++) {
        text += (text ? ' ' : '') + this.cues[i].text;
      }

      this.words = text.split(/\s+/).filter(w => w.length > 0);

      this._emit('wordsReady', {
        words: this.words,
        cueIndex,
        snippetStart,
        totalWords: this._totalWordsInCues(),
      });
    }

    _totalWordsInCues() {
      let count = 0;
      for (const cue of this.cues) {
        count += cue.text.split(/\s+/).filter(w => w.length > 0).length;
      }
      return count;
    }

    /**
     * Called when user types a correct word.
     */
    advanceWord() {
      this.currentWordIndex++;
      this.clearFlowTimer();
      this._emit('wordAdvance', { wordIndex: this.currentWordIndex });

      // Check if we finished the snippet
      if (this.currentWordIndex >= this.words.length) {
        // Move to next cue's words
        const nextCue = this.currentCueIndex + 1;
        if (nextCue < this.cues.length) {
          this.currentCueIndex = nextCue;
          this.currentWordIndex = 0;
          this._buildWords(nextCue);
        }
      }

      // Resume video if we're catching up
      if (this.isPausedByUs && !this._isLagging()) {
        this._resumeVideo();
      }
    }

    /**
     * Check if user has fallen behind.
     */
    _isLagging() {
      if (!this.autoPauseEnabled) return false;

      // Count how many words behind we are
      const currentTimeMs = this.video ? this.video.currentTime * 1000 : 0;

      // Find current cue's first word index in overall sequence
      let overallWordIndex = 0;
      for (let i = 0; i < this.currentCueIndex; i++) {
        const c = this.cues[i];
        overallWordIndex += c.text.split(/\s+/).filter(w => w.length > 0).length;
      }
      overallWordIndex += this.currentWordIndex;

      // Find where the video is: count words up to current video time
      let videoWordIndex = 0;
      for (const c of this.cues) {
        if (c.startMs > currentTimeMs) break;
        const w = c.text.split(/\s+/).filter(w => w.length > 0).length;
        videoWordIndex += w;
      }

      return (videoWordIndex - overallWordIndex) > this.lagThreshold;
    }

    _checkLag() {
      if (!this.autoPauseEnabled || !this.isPlaying) return;

      if (this._isLagging()) {
        this._pauseVideo();
        if (this.strictMode) {
          // Wait for user to type
        } else {
          // Flow mode: start skip timer
          this._startFlowTimer();
        }
      }
    }

    _pauseVideo() {
      if (this.video && !this.video.paused) {
        this.video.pause();
        this.isPausedByUs = true;
        this._emit('autoPause', {});
      }
    }

    _resumeVideo() {
      if (this.video && this.isPausedByUs) {
        this.video.play().catch(() => {});
        this.isPausedByUs = false;
        this._emit('autoResume', {});
      }
    }

    _startFlowTimer() {
      this.clearFlowTimer();
      this.flowSkipTimer = setTimeout(() => {
        // Skip ahead to current video position
        if (this.video) {
          this._syncToTime(this.video.currentTime, true);
        }
      }, this.flowTimeout);
    }

    clearFlowTimer() {
      if (this.flowSkipTimer) {
        clearTimeout(this.flowSkipTimer);
        this.flowSkipTimer = null;
      }
    }

    _resetWordPositionAtCurrentCue() {
      this._syncToTime(this.video ? this.video.currentTime : 0, true);
    }

    /**
     * Get the current word the user should type.
     */
    getCurrentWord() {
      if (this.currentWordIndex < this.words.length) {
        return this.words[this.currentWordIndex];
      }
      return null;
    }

    /**
     * Get upcoming words for display.
     */
    getDisplayWords() {
      const maxDisplay = 20;
      const start = Math.max(0, this.currentWordIndex - 2);
      const end = Math.min(this.words.length, start + maxDisplay);
      return this.words.slice(start, end);
    }

    /**
     * Get the word display offset (how many words before current).
     */
    getDisplayOffset() {
      return Math.max(0, this.currentWordIndex - 2);
    }

    getCurrentWordDisplayIndex() {
      return this.currentWordIndex - this.getDisplayOffset();
    }

    isComplete() {
      return this.currentCueIndex >= this.cues.length - 1 &&
             this.currentWordIndex >= this.words.length - 1;
    }

    getStats() {
      let totalWords = 0;
      for (const c of this.cues) {
        totalWords += c.text.split(/\s+/).filter(w => w.length > 0).length;
      }
      return { totalWords, currentWordGlobal: this._globalWordIndex() };
    }

    _globalWordIndex() {
      let idx = 0;
      for (let i = 0; i < this.currentCueIndex; i++) {
        idx += this.cues[i].text.split(/\s+/).filter(w => w.length > 0).length;
      }
      idx += this.currentWordIndex;
      return idx;
    }

    setOptions(opts) {
      if (opts.lagThreshold !== undefined) this.lagThreshold = opts.lagThreshold;
      if (opts.autoPauseEnabled !== undefined) this.autoPauseEnabled = opts.autoPauseEnabled;
      if (opts.strictMode !== undefined) this.strictMode = opts.strictMode;
      if (opts.flowTimeout !== undefined) this.flowTimeout = opts.flowTimeout;
    }
  };

})(typeof globalThis !== 'undefined' ? globalThis : window);
