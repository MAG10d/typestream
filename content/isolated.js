// TypeStream - ISOLATED World Content Script (Orchestrator)
// Injected at document_idle into ISOLATED world.
// Coordinates MAIN world communication, subtitle fetching, sync engine,
// typing engine, UI panel, and SPA navigation handling.

(function() {
  'use strict';

  const TS_MSG = 'TYPESTREAM_MAIN_WORLD';
  const IS_YT_SHORTS = window.location.pathname.startsWith('/shorts/');

  // Don't run on YouTube Shorts (no standard timedtext captions)
  if (IS_YT_SHORTS) return;

  // ========== State ==========
  let panel = null;
  let syncEngine = null;
  let typingEngine = null;
  let video = null;
  let cues = [];
  let isInitialized = false;
  let isSessionActive = false;
  let currentVideoId = '';
  let lastPathname = window.location.pathname;
  let _statsInterval = null;

  // Settings (defaults)
  let settings = {
    autoPause: true,
    strictMode: false,
    ignorePunctuation: true,
    ignoreCase: true,
    lagThreshold: 5,
    flowTimeout: 3000,
    fontSize: 20,
  };

  // ========== Init ==========
  function init() {
    if (isInitialized) return;
    isInitialized = true;

    loadSettings();
    start();
  }

  function loadSettings() {
    try {
      chrome.storage.local.get(['typestream_settings'], (result) => {
        if (result.typestream_settings) {
          settings = { ...settings, ...result.typestream_settings };
        }
        start();
      });
    } catch (e) {
      // Fallback if chrome.storage not available
      start();
    }
  }

  function saveSettings() {
    try {
      chrome.storage.local.set({ typestream_settings: settings });
    } catch (e) { /* ignore */ }
  }

  function start() {
    // Wait for video element
    const waitForVideo = () => {
      video = document.querySelector('video.html5-main-video, video');
      if (!video) {
        setTimeout(waitForVideo, 500);
        return;
      }
      currentVideoId = getVideoId();
      setupPanel();
      requestSubtitles();
    };

    waitForVideo();
  }

  function getVideoId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('v') || '';
  }

  // ========== SPA Navigation Handling ==========
  function watchNavigation() {
    // Listen for yt-navigate-finish (YouTube's custom SPA event)
    document.addEventListener('yt-navigate-finish', (e) => {
      const newPathname = window.location.pathname;

      // Only handle /watch pages
      if (newPathname.startsWith('/shorts/')) return;

      if (newPathname !== lastPathname) {
        lastPathname = newPathname;
        handleNavigation();
      }
    });

    // Backup: MutationObserver on title (YouTube changes title on navigation)
    const titleEl = document.querySelector('title');
    if (titleEl) {
      const titleObserver = new MutationObserver(() => {
        const newPathname = window.location.pathname;
        const newVideoId = getVideoId();
        if (newVideoId && newVideoId !== currentVideoId) {
          currentVideoId = newVideoId;
          handleNavigation();
        }
      });
      titleObserver.observe(titleEl, { childList: true, subtree: true });
    }

    // Backup: popstate for browser back/forward
    window.addEventListener('popstate', () => {
      setTimeout(() => {
        const newPathname = window.location.pathname;
        if (newPathname !== lastPathname) {
          lastPathname = newPathname;
          handleNavigation();
        }
      }, 200);
    });
  }

  function handleNavigation() {
    // Tear down old session
    teardown();

    const newVideoId = getVideoId();
    if (!newVideoId) {
      // Not a /watch page, don't re-initialize
      return;
    }

    currentVideoId = newVideoId;

    // Wait for new video element
    let retries = 0;
    const waitForNewVideo = () => {
      video = document.querySelector('video.html5-main-video, video');
      if (video && video.readyState >= 0) {
        setupPanel();
        requestSubtitles();
      } else if (retries < 20) {
        retries++;
        setTimeout(waitForNewVideo, 500);
      }
    };
    waitForNewVideo();
  }

  // ========== Subtitle Fetching ==========
  function requestSubtitles() {
    // Request caption data from MAIN world
    window.postMessage({ source: TS_MSG, type: 'REQUEST_CAPTIONS' }, '*');

    // Also listen for proactive MAIN world messages
    window.addEventListener('message', handleMainWorldMessage);
  }

  function handleMainWorldMessage(event) {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== TS_MSG) return;

    if (msg.payload && msg.payload.type === 'CAPTIONS_DATA') {
      onCaptionsData(msg.payload);
    }
  }

  async function onCaptionsData(data) {
    if (!data.bestTrack) {
      if (panel) panel.showNoCaptions(data.title);
      return;
    }

    const track = data.bestTrack;
    const baseUrl = track.baseUrl;

    // Fetch subtitle content via background service worker (bypass CORS)
    // First try with JSON format (easier to parse)
    let subtitleUrl = baseUrl + '&fmt=json3';

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'FETCH_SUBTITLES',
        url: subtitleUrl,
      });

      if (response.success) {
        const jsonData = JSON.parse(response.data);
        cues = parseJson3Cues(jsonData);

        if (!cues || cues.length === 0) {
          // Fallback: try VTT format
          await fetchVTT(baseUrl);
        }
      } else {
        await fetchVTT(baseUrl);
      }
    } catch (e) {
      // Fallback to VTT
      await fetchVTT(baseUrl);
    }

    if (cues && cues.length > 0) {
      initializeSession();
    } else {
      if (panel) panel.showNoCaptions(data.title);
    }
  }

  async function fetchVTT(baseUrl) {
    const vttUrl = baseUrl + '&fmt=vtt';

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'FETCH_SUBTITLES',
        url: vttUrl,
      });

      if (response.success) {
        cues = TypeStreamParser.autoDetect(response.data);
      }
    } catch (e) {
      console.error('TypeStream: Failed to fetch subtitles', e);
      cues = [];
    }
  }

  function parseJson3Cues(json) {
    const results = [];
    if (!json.events || !Array.isArray(json.events)) return results;

    for (const evt of json.events) {
      if (evt.segs) {
        const startMs = evt.tStartMs || 0;
        const durMs = evt.dDurationMs || 0;
        const text = evt.segs.map(s => s.utf8 || '').join(' ').trim();
        if (text) {
          results.push({
            startMs,
            endMs: startMs + durMs,
            text: cleanJson3Text(text),
          });
        }
      }
    }
    return results;
  }

  function cleanJson3Text(text) {
    return text
      .replace(/\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ========== Session Management ==========
  function initializeSession() {
    if (panel) panel.unmount();
    setupPanel();

    if (!video || !cues.length) return;

    // Create sync engine
    syncEngine = new TypeStreamSyncEngine({
      lagThreshold: settings.lagThreshold,
      autoPauseEnabled: settings.autoPause,
      strictMode: settings.strictMode,
      flowTimeout: settings.flowTimeout,
    });

    // Create typing engine
    typingEngine = new TypeStreamTypingEngine({
      ignorePunctuation: settings.ignorePunctuation,
      ignoreCase: settings.ignoreCase,
    });

    // Wire callbacks
    syncEngine.on('wordsReady', (data) => {
      if (data.words && data.words.length > 0) {
        const currentWord = syncEngine.getCurrentWord();
        typingEngine.setWord(currentWord);
        typingEngine.isActive = true;
        renderWords(data.words);
      }
    });

    syncEngine.on('cueChange', (data) => {
      // Cue changed - reset typing for new words
      if (data.words.length > 0) {
        typingEngine.setWord(syncEngine.getCurrentWord());
        renderWords(data.words);
      }
    });

    syncEngine.on('autoPause', () => {
      updatePausedState(true);
    });

    syncEngine.on('autoResume', () => {
      updatePausedState(false);
    });

    syncEngine.on('wordAdvance', (data) => {
      // Word was advanced - typing engine handles display
      const currentWord = syncEngine.getCurrentWord();
      if (currentWord) {
        typingEngine.setWord(currentWord);
      }
      const words = syncEngine.getDisplayWords();
      renderWords(words);
    });

    typingEngine.on('wordUpdate', (data) => {
      const words = syncEngine.getDisplayWords();
      const currentIdx = syncEngine.getCurrentWordDisplayIndex();
      const charDiff = typingEngine.getCharDiff();
      const isPaused = syncEngine.isPausedByUs;

      if (panel) {
        panel.render(words, syncEngine.currentWordIndex, {
          charDiff,
          isPaused,
        });
      }
    });

    typingEngine.on('wordComplete', (data) => {
      syncEngine.advanceWord();
      updateStats();
      const words = syncEngine.getDisplayWords();
      if (words.length > 0) renderWords(words);
    });

    typingEngine.on('focusChange', (data) => {
      // Visual indication handled by panel
    });

    // Attach engines
    syncEngine.attach(video, cues);
    typingEngine.attach(panel.container);
    typingEngine.startSession();
    typingEngine.focus();

    isSessionActive = true;

    // Start stats update interval
    if (_statsInterval) clearInterval(_statsInterval);
    _statsInterval = setInterval(updateStats, 250);

    updateStats();

    // Initial render
    const words = syncEngine.getDisplayWords();
    if (words.length > 0) {
      renderWords(words);
    }
  }

  function renderWords(words) {
    if (!panel) return;
    const currentIdx = syncEngine.currentWordIndex;
    const charDiff = typingEngine.getCharDiff();
    const isPaused = syncEngine ? syncEngine.isPausedByUs : false;
    panel.render(words, currentIdx, { charDiff, isPaused });
  }

  function updatePausedState(paused) {
    if (!panel) return;
    const words = syncEngine.getDisplayWords();
    const currentIdx = syncEngine.currentWordIndex;
    const charDiff = typingEngine.getCharDiff();
    panel.render(words, currentIdx, { charDiff, isPaused: paused });
  }

  function updateStats() {
    if (!panel || !typingEngine) return;
    const stats = typingEngine.getStats();
    panel.updateStats(stats);
  }

  // ========== Panel Setup ==========
  function setupPanel() {
    if (panel) return;

    panel = new TypeStreamPanel();
    const mounted = panel.mount();

    if (!mounted) {
      // Retry after a short delay
      setTimeout(() => {
        panel = new TypeStreamPanel();
        panel.mount();
      }, 1000);
      return;
    }

    panel.on('close', () => {
      teardown();
    });

    panel.on('settingChange', (data) => {
      handleSettingChange(data.key, data.value);
    });

    // Clicking the panel focuses the typing engine
    if (panel.container) {
      panel.container.addEventListener('click', () => {
        if (typingEngine) {
          typingEngine.focus();
        }
      });
    }
  }

  function handleSettingChange(key, value) {
    settings[key] = value;
    saveSettings();

    if (syncEngine) syncEngine.setOptions(settings);
    if (typingEngine) typingEngine.setOptions(settings);
  }

  // ========== Teardown ==========
  function teardown() {
    if (syncEngine) {
      syncEngine.detach();
      syncEngine = null;
    }
    if (typingEngine) {
      typingEngine.detach();
      typingEngine = null;
    }
    if (panel) {
      panel.unmount();
      panel = null;
    }
    if (_statsInterval) {
      clearInterval(_statsInterval);
      _statsInterval = null;
    }
    cues = [];
    isSessionActive = false;
  }

  // ========== Boot ==========
  init();
  watchNavigation();

  // Listen for MAIN world messages
  window.addEventListener('message', handleMainWorldMessage);

  // Listen for popup messages
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_STATUS') {
      sendResponse({ active: isSessionActive });
      return true;
    }
    if (message.type === 'TOGGLE_PANEL') {
      if (isSessionActive) {
        teardown();
        sendResponse({ active: false });
      } else {
        start();
        sendResponse({ active: true });
      }
      return true;
    }
  });

})();
