// TypeStream - UI Panel (Shadow DOM)
// Builds the typing interface inside a Shadow DOM root. Handles rendering,
// dragging, collapsing, and settings UI.

(function(global) {
  'use strict';

  global.TypeStreamPanel = class TypeStreamPanel {
    constructor() {
      this.container = null;
      this.shadowRoot = null;
      this.settingsOpen = false;
      this.visible = false;
      this.videoTitle = '';

      // Panel state
      this.isCollapsed = false;
      this.dragOffset = { x: 0, y: 0 };
      this.position = { x: 0, y: 0 };

      // References to DOM elements
      this.el = {};

      // Callbacks
      this._callbacks = {};
    }

    on(event, fn) {
      this._callbacks[event] = fn;
    }

    _emit(event, data) {
      if (this._callbacks[event]) this._callbacks[event](data);
    }

    /**
     * Create and inject the TypeStream panel into the YouTube page.
     * The panel is placed below the video player in the primary column.
     */
    mount() {
      console.log('[TypeStream] Panel.mount() searching for insertion point...');

      // Find container: try multiple YouTube layout selectors
      let mountPoint = null;

      const selectors = [
        '#below',
        '#player-container',
        '#primary-inner',
        '#primary',
        '#columns',
      ];

      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          console.log('[TypeStream] Found mount point:', sel);
          mountPoint = el;
          break;
        }
      }

      if (!mountPoint) {
        // Last resort: find movie_player and insert after it
        const moviePlayer = document.querySelector('#movie_player, #player, video');
        if (moviePlayer) {
          console.log('[TypeStream] Found video player, inserting after it');
          this.container = document.createElement('div');
          this.container.id = 'typestream-panel';
          this.container.style.cssText = 'margin-top: 8px;';
          moviePlayer.insertAdjacentElement('afterend', this.container);
          this._buildShadowDOM();
          this.visible = true;
          return true;
        }
        console.warn('[TypeStream] No mount point found!');
        return false;
      }

      this.container = document.createElement('div');
      this.container.id = 'typestream-panel';
      this.container.style.cssText = 'margin-top: 8px;';

      mountPoint.insertBefore(this.container, mountPoint.firstChild);

      this._buildShadowDOM();
      this.visible = true;
      console.log('[TypeStream] Panel mounted successfully');
      return true;
    }

    unmount() {
      if (this.container && this.container.parentElement) {
        this.container.parentElement.removeChild(this.container);
      }
      this.container = null;
      this.shadowRoot = null;
      this.visible = false;
    }

    _buildShadowDOM() {
      this.shadowRoot = this.container.attachShadow({ mode: 'open' });

      // Load Google Fonts inside shadow DOM
      const fontLink = document.createElement('link');
      fontLink.rel = 'stylesheet';
      fontLink.href = 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap';
      this.shadowRoot.appendChild(fontLink);

      const styleEl = document.createElement('style');
      styleEl.textContent = global.TypeStreamStyles;
      this.shadowRoot.appendChild(styleEl);

      const wrapper = document.createElement('div');
      wrapper.className = 'ts-container';
      wrapper.id = 'ts-panel';
      wrapper.innerHTML = `
        ${this._headerHTML()}
        ${this._statsHTML()}
        <div class="ts-typing-area" id="ts-words"></div>
        ${this._settingsHTML()}
      `;
      this.shadowRoot.appendChild(wrapper);

      this.el = {
        panel: this.shadowRoot.getElementById('ts-panel'),
        header: this.shadowRoot.querySelector('.ts-header'),
        title: this.shadowRoot.querySelector('.ts-title'),
        closeBtn: this.shadowRoot.getElementById('ts-btn-close'),
        settingsBtn: this.shadowRoot.getElementById('ts-btn-settings'),
        statsBar: this.shadowRoot.getElementById('ts-stats-bar'),
        wordsEl: this.shadowRoot.getElementById('ts-words'),
        settingsEl: this.shadowRoot.getElementById('ts-settings'),
        autoPause: this.shadowRoot.getElementById('ts-auto-pause'),
        ignorePunct: this.shadowRoot.getElementById('ts-ignore-punct'),
        ignoreCase: this.shadowRoot.getElementById('ts-ignore-case'),
        lagThreshold: this.shadowRoot.getElementById('ts-lag-threshold'),
        lagValue: this.shadowRoot.getElementById('ts-lag-value'),
        fontSize: this.shadowRoot.getElementById('ts-font-size'),
        fontSizeValue: this.shadowRoot.getElementById('ts-font-size-value'),
        strictMode: this.shadowRoot.getElementById('ts-strict-mode'),
        flowTimeout: this.shadowRoot.getElementById('ts-flow-timeout'),
        flowValue: this.shadowRoot.getElementById('ts-flow-value'),
      };

      this._bindEvents();
    }

    _headerHTML() {
      return `
        <div class="ts-header">
          <span class="ts-title" id="ts-drag-handle">⌨ TypeStream</span>
          <div class="ts-header-actions">
            <button class="ts-btn" id="ts-btn-settings" title="Settings">⚙</button>
            <button class="ts-btn" id="ts-btn-close" title="Close">✕</button>
          </div>
        </div>
      `;
    }

    _statsHTML() {
      return `
        <div class="ts-stats" id="ts-stats-bar">
          <div class="ts-stat">
            <span class="ts-stat-value" id="ts-wpm">0</span>
            <span class="ts-stat-label">wpm</span>
          </div>
          <div class="ts-stat">
            <span class="ts-stat-value" id="ts-acc">100%</span>
            <span class="ts-stat-label">acc</span>
          </div>
          <div class="ts-stat">
            <span class="ts-stat-value" id="ts-words">0</span>
            <span class="ts-stat-label">words</span>
          </div>
          <div class="ts-stat">
            <span class="ts-stat-value" id="ts-time">0:00</span>
            <span class="ts-stat-label">time</span>
          </div>
        </div>
      `;
    }

    _settingsHTML() {
      return `
        <div class="ts-settings" id="ts-settings">
          <div class="ts-settings-row">
            <span class="ts-settings-label">Auto-pause</span>
            <label class="ts-toggle">
              <input type="checkbox" id="ts-auto-pause" checked>
              <span class="ts-toggle-slider"></span>
            </label>
          </div>
          <div class="ts-settings-row">
            <span class="ts-settings-label">Strict mode</span>
            <label class="ts-toggle">
              <input type="checkbox" id="ts-strict-mode">
              <span class="ts-toggle-slider"></span>
            </label>
          </div>
          <div class="ts-settings-row">
            <span class="ts-settings-label">Ignore punctuation</span>
            <label class="ts-toggle">
              <input type="checkbox" id="ts-ignore-punct" checked>
              <span class="ts-toggle-slider"></span>
            </label>
          </div>
          <div class="ts-settings-row">
            <span class="ts-settings-label">Ignore case</span>
            <label class="ts-toggle">
              <input type="checkbox" id="ts-ignore-case" checked>
              <span class="ts-toggle-slider"></span>
            </label>
          </div>
          <div class="ts-settings-row">
            <span class="ts-settings-label">Lag threshold</span>
            <div style="display:flex;align-items:center;gap:8px;">
              <input type="range" class="ts-slider-input" id="ts-lag-threshold" min="1" max="20" value="5">
              <span id="ts-lag-value" style="font-size:12px;color:#e2b714;min-width:20px;">5</span>
            </div>
          </div>
          <div class="ts-settings-row" id="ts-flow-row" style="display:none;">
            <span class="ts-settings-label">Flow timeout (s)</span>
            <div style="display:flex;align-items:center;gap:8px;">
              <input type="range" class="ts-slider-input" id="ts-flow-timeout" min="1" max="10" value="3">
              <span id="ts-flow-value" style="font-size:12px;color:#e2b714;min-width:20px;">3</span>
            </div>
          </div>
          <div class="ts-settings-row">
            <span class="ts-settings-label">Font size</span>
            <div style="display:flex;align-items:center;gap:8px;">
              <input type="range" class="ts-slider-input" id="ts-font-size" min="14" max="32" value="20">
              <span id="ts-font-size-value" style="font-size:12px;color:#e2b714;min-width:24px;">20px</span>
            </div>
          </div>
        </div>
      `;
    }

    _bindEvents() {
      // Close button
      this.el.closeBtn.addEventListener('click', () => {
        this._emit('close', {});
      });

      // Settings toggle
      this.el.settingsBtn.addEventListener('click', () => {
        this.settingsOpen = !this.settingsOpen;
        this.el.settingsEl.classList.toggle('open', this.settingsOpen);
      });

      // Settings: auto-pause
      this.el.autoPause.addEventListener('change', () => {
        this._emit('settingChange', { key: 'autoPause', value: this.el.autoPause.checked });
      });

      // Settings: strict mode
      this.el.strictMode.addEventListener('change', () => {
        const isStrict = this.el.strictMode.checked;
        const flowRow = this.shadowRoot.getElementById('ts-flow-row');
        if (flowRow) flowRow.style.display = isStrict ? 'none' : 'flex';
        this._emit('settingChange', { key: 'strictMode', value: isStrict });
      });

      // Settings: ignore punctuation
      this.el.ignorePunct.addEventListener('change', () => {
        this._emit('settingChange', { key: 'ignorePunctuation', value: this.el.ignorePunct.checked });
      });

      // Settings: ignore case
      this.el.ignoreCase.addEventListener('change', () => {
        this._emit('settingChange', { key: 'ignoreCase', value: this.el.ignoreCase.checked });
      });

      // Settings: lag threshold
      this.el.lagThreshold.addEventListener('input', () => {
        const val = parseInt(this.el.lagThreshold.value);
        this.el.lagValue.textContent = val;
        this._emit('settingChange', { key: 'lagThreshold', value: val });
      });

      // Settings: flow timeout
      this.el.flowTimeout.addEventListener('input', () => {
        const val = parseInt(this.el.flowTimeout.value);
        this.el.flowValue.textContent = val;
        this._emit('settingChange', { key: 'flowTimeout', value: val * 1000 });
      });

      // Settings: font size
      this.el.fontSize.addEventListener('input', () => {
        const val = parseInt(this.el.fontSize.value);
        this.el.fontSizeValue.textContent = val + 'px';
        this.el.wordsEl.style.setProperty('--word-font-size', val + 'px');
        this._updateFontSize(val);
      });

      // Dragging (title bar)
      const header = this.el.header;
      let isDragging = false;
      let startX, startY, startLeft, startTop;

      header.addEventListener('mousedown', (e) => {
        if (e.target.tagName === 'BUTTON') return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        const rect = this.el.panel.getBoundingClientRect();
        startLeft = rect.left;
        startTop = rect.top;

        this.el.panel.style.position = 'fixed';
        this.el.panel.style.left = startLeft + 'px';
        this.el.panel.style.top = startTop + 'px';
        this.el.panel.style.zIndex = '9999';
        this.el.panel.style.cursor = 'grabbing';
      });

      document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        this.el.panel.style.left = (startLeft + dx) + 'px';
        this.el.panel.style.top = (startTop + dy) + 'px';
      });

      document.addEventListener('mouseup', () => {
        if (isDragging) {
          isDragging = false;
          this.el.panel.style.cursor = '';
        }
      });
    }

    _updateFontSize(size) {
      const wordEls = this.el.wordsEl.querySelectorAll('.ts-word');
      wordEls.forEach(el => {
        el.style.fontSize = size + 'px';
      });
    }

    /**
     * Render words with typing state.
     */
    render(words, currentIndex, typingState) {
      if (!this.el.wordsEl) return;

      this.el.wordsEl.innerHTML = '';

      if (!words || words.length === 0) {
        this.el.wordsEl.innerHTML = `
          <div class="ts-empty-state">
            <div class="ts-empty-icon">🎬</div>
            <div class="ts-empty-text">Waiting for subtitles...</div>
            <div class="ts-empty-subtext">Play a YouTube video with English captions</div>
          </div>
        `;
        return;
      }

      const displayWords = words;
      const displayOffset = currentIndex > 2 ? currentIndex - 2 : 0;
      const displayCurrentIdx = currentIndex - displayOffset;

      for (let i = 0; i < displayWords.length; i++) {
        const word = displayWords[i];
        const wordEl = document.createElement('span');
        wordEl.className = 'ts-word';

        if (i < displayCurrentIdx) {
          wordEl.className += ' correct';
          wordEl.textContent = word;
        } else if (i === displayCurrentIdx) {
          wordEl.className += ' current';
          // Character-level diff for current word
          if (typingState && typingState.charDiff) {
            for (const cd of typingState.charDiff) {
              const charEl = document.createElement('span');
              charEl.className = 'ts-char ' + cd.status;
              charEl.textContent = cd.char;
              wordEl.appendChild(charEl);
            }
          } else {
            wordEl.textContent = word;
          }
        } else {
          wordEl.className += ' untyped';
          wordEl.textContent = word;
        }

        this.el.wordsEl.appendChild(wordEl);
      }

      // Handle blur when paused
      if (typingState && typingState.isPaused) {
        this.el.wordsEl.classList.add('paused');
      } else {
        this.el.wordsEl.classList.remove('paused');
      }
    }

    /**
     * Update stats display.
     */
    updateStats(stats) {
      const wpmEl = this.shadowRoot.getElementById('ts-wpm');
      const accEl = this.shadowRoot.getElementById('ts-acc');
      const wordsEl = this.shadowRoot.getElementById('ts-words');
      const timeEl = this.shadowRoot.getElementById('ts-time');

      if (wpmEl) wpmEl.textContent = stats.wpm;
      if (accEl) accEl.textContent = stats.accuracy + '%';
      if (wordsEl) wordsEl.textContent = stats.wordsDone;

      if (timeEl) {
        const totalSec = Math.floor(stats.sessionTime / 1000);
        const m = Math.floor(totalSec / 60);
        const s = totalSec % 60;
        timeEl.textContent = m + ':' + s.toString().padStart(2, '0');
      }
    }

    /**
     * Show "no captions" state.
     */
    showNoCaptions(videoTitle = '') {
      if (!this.el.wordsEl) return;

      this.el.wordsEl.innerHTML = `
        <div class="ts-empty-state">
          <div class="ts-empty-icon">📄</div>
          <div class="ts-empty-text">No English Captions Available</div>
          <div class="ts-empty-subtext">
            ${videoTitle ? '&ldquo;' + videoTitle + '&rdquo; ' : 'This video '}does not have English subtitles
          </div>
        </div>
      `;
    }

    /**
     * Show a toast notification.
     */
    showToast(message, duration = 4000) {
      const toast = document.createElement('div');
      toast.className = 'ts-toast';
      toast.textContent = message;
      document.body.appendChild(toast);

      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => {
          if (toast.parentElement) {
            toast.parentElement.removeChild(toast);
          }
        }, 300);
      }, duration);
    }

    /**
     * Rebuild everything (e.g., for SPA navigation).
     */
    refresh() {
      // Unmount and mount fresh
      const oldContainer = this.container;
      this.unmount();

      if (oldContainer && oldContainer.parentElement) {
        this.container = document.createElement('div');
        this.container.id = 'typestream-panel';
        this.container.style.cssText = 'margin-top: 8px;';
        oldContainer.parentElement.replaceChild(this.container, oldContainer);
      }

      this._buildShadowDOM();
      this.visible = true;
      this._emit('ready', {});
    }
  };

})(typeof globalThis !== 'undefined' ? globalThis : window);
