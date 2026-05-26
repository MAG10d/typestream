// TypeStream - ISOLATED World Content Script (Orchestrator)
// Coordinates MAIN world communication, subtitle fetching, sync engine,
// typing engine, UI panel, and SPA navigation handling.

(function() {
  'use strict';

  const TS_MSG = 'TYPESTREAM_MAIN_WORLD';

  // Don't run on YouTube Shorts or non-video pages
  if (window.location.pathname.startsWith('/shorts/')) return;
  if (!window.location.pathname.startsWith('/watch')) {
    // Still watch for SPA navigation into /watch
    watchForWatchPage();
    return;
  }

  // ========== State ==========
  let panel = null;
  let syncEngine = null;
  let typingEngine = null;
  let video = null;
  let cues = [];
  let isSessionActive = false;
  let currentVideoId = '';
  let _statsInterval = null;
  let _captionsResolved = false;

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

  // ========== Boot ==========
  boot();

  function boot() {
    console.log('[TypeStream] Booting...');
    loadSettings(() => {
      console.log('[TypeStream] Settings loaded, mounting panel...');
      setupPanel();
      waitForVideo();
    });
  }

  function loadSettings(cb) {
    try {
      chrome.storage.local.get(['typestream_settings'], (result) => {
        if (result && result.typestream_settings) {
          settings = { ...settings, ...result.typestream_settings };
        }
        cb();
      });
    } catch (e) {
      cb();
    }
  }

  function saveSettings() {
    try {
      chrome.storage.local.set({ typestream_settings: settings });
    } catch (e) { /* ignore */ }
  }

  // ========== Video + Subtitle Init ==========

  function waitForVideo() {
    let attempts = 0;
    const tryFind = () => {
      video = document.querySelector('video.html5-main-video, video');
      if (video) {
        currentVideoId = getVideoId();
        if (currentVideoId) {
          requestSubtitles();
          return;
        }
      }
      attempts++;
      if (attempts < 60) {
        setTimeout(tryFind, 500);
      }
    };
    tryFind();
  }

  function getVideoId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('v') || '';
  }

  // ========== MAIN World Communication ==========

  function requestSubtitles() {
    _captionsResolved = false;
    // Main world script polls ytInitialPlayerResponse and pushes data
    window.addEventListener('message', handleMainWorldMessage);

    // Also actively request (in case main world script hasn't auto-detected)
    window.postMessage({ source: TS_MSG, type: 'REQUEST_CAPTIONS' }, '*');

    // Retry a few times in case ytInitialPlayerResponse isn't ready yet
    let retries = 0;
    const retry = () => {
      if (_captionsResolved) return;
      retries++;
      if (retries < 10) {
        window.postMessage({ source: TS_MSG, type: 'REQUEST_CAPTIONS' }, '*');
        setTimeout(retry, 800);
      } else {
        // Give up: show no captions
        if (panel) panel.showNoCaptions();
      }
    };
    setTimeout(retry, 800);
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
    if (_captionsResolved) return; // already handled — also prevents duplicate logs
    _captionsResolved = true;

    console.log('[TypeStream] Captions:',
      data.tracks?.length + ' tracks, best=' + (data.bestTrack ? 'yes' : 'no'),
      'videoId=' + data.videoId, data.debug);

    if (!data.bestTrack || !data.tracks || data.tracks.length === 0) {
      // Fallback: try constructing timedtext URL directly
      // Use videoId from MAIN world, or extract from current URL
      const vid = data.videoId || getVideoId();
      if (vid) {
        console.log('[TypeStream] Fallback: direct timedtext fetch for', vid);
        const directUrl = 'https://www.youtube.com/api/timedtext?v=' + vid + '&lang=en';
        await fetchVTT(directUrl);
        if (cues && cues.length > 0) {
          initializeSession();
          return;
        }
      }
      if (panel) panel.showNoCaptions(data.title);
      return;
    }

    const track = data.bestTrack;
    const baseUrl = track.baseUrl;

    // baseUrl is relative like "/api/timedtext?key=..." - make it absolute
    const absoluteBase = baseUrl.startsWith('http') ? baseUrl : 'https://www.youtube.com' + baseUrl;

    // Try fetching directly first (timedtext API allows CORS from youtube.com)
    let text = await fetchTimedText(absoluteBase + '&fmt=json3');

    if (text) {
      try {
        cues = parseJson3Cues(JSON.parse(text));
      } catch (e) {
        console.log('[TypeStream] json3 parse failed, trying VTT...', e.message);
        text = await fetchTimedText(absoluteBase + '&fmt=vtt');
        if (text) cues = TypeStreamParser.autoDetect(text);
      }
    } else {
      // Fallback: VTT
      text = await fetchTimedText(absoluteBase + '&fmt=vtt');
      if (text) cues = TypeStreamParser.autoDetect(text);
    }

    if (!cues || cues.length === 0) {
      // Last resort: direct timedtext URL from videoId
      const vid = data.videoId || getVideoId();
      if (vid) {
        console.log('[TypeStream] Last resort: direct timedtext for', vid);
        const directVtt = await fetchTimedText('https://www.youtube.com/api/timedtext?v=' + vid + '&lang=en&fmt=vtt');
        if (directVtt) cues = TypeStreamParser.autoDetect(directVtt);
      }
    }

    if (cues && cues.length > 0) {
      initializeSession();
    } else {
      if (panel) panel.showNoCaptions(data.title);
    }
  }

  /**
   * Fetches a timedtext URL, trying direct fetch first (timedtext API is CORS-friendly),
   * then falling back to background service worker.
   */
  async function fetchTimedText(url) {
    console.log('[TypeStream] Fetching:', url.substring(0, 120));
    // Try direct fetch first
    try {
      const resp = await fetch(url);
      if (resp.ok) {
        const text = await resp.text();
        console.log('[TypeStream] Direct fetch OK:', text.length, 'bytes');
        return text;
      }
      console.log('[TypeStream] Direct fetch status:', resp.status);
    } catch (e) {
      console.log('[TypeStream] Direct fetch error:', e.message);
    }
    // Fallback: background SW
    try {
      const response = await chrome.runtime.sendMessage({ type: 'FETCH_SUBTITLES', url });
      if (response && response.success) {
        console.log('[TypeStream] SW fetch OK:', response.data.length, 'bytes');
        return response.data;
      }
    } catch (e) {
      console.error('[TypeStream] SW fetch error:', e.message);
    }
    return null;
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
    return text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // ========== Session ==========

  function initializeSession() {
    if (!panel || !video || !cues.length) return;

    // Rebuild panel clean (close old shadow dom, rebuild)
    if (panel.container) {
      panel.unmount();
    }
    setupPanel();

    syncEngine = new TypeStreamSyncEngine({
      lagThreshold: settings.lagThreshold,
      autoPauseEnabled: settings.autoPause,
      strictMode: settings.strictMode,
      flowTimeout: settings.flowTimeout,
    });

    typingEngine = new TypeStreamTypingEngine({
      ignorePunctuation: settings.ignorePunctuation,
      ignoreCase: settings.ignoreCase,
    });

    // Wire sync -> typing
    syncEngine.on('wordsReady', (data) => {
      if (data.words.length > 0) {
        typingEngine.setWord(syncEngine.getCurrentWord());
        typingEngine.isActive = true;
      }
      renderAll();
    });

    syncEngine.on('cueChange', () => {
      typingEngine.setWord(syncEngine.getCurrentWord());
      renderAll();
    });

    syncEngine.on('wordAdvance', () => {
      typingEngine.setWord(syncEngine.getCurrentWord());
      renderAll();
    });

    syncEngine.on('autoPause', () => renderAll());
    syncEngine.on('autoResume', () => renderAll());

    typingEngine.on('wordUpdate', () => renderAll());
    typingEngine.on('wordComplete', () => {
      syncEngine.advanceWord();
      renderAll();
    });
    typingEngine.on('focusChange', () => {});

    syncEngine.attach(video, cues);
    typingEngine.attach(panel.container);
    typingEngine.startSession();
    typingEngine.focus();
    isSessionActive = true;

    // Stats poll
    if (_statsInterval) clearInterval(_statsInterval);
    _statsInterval = setInterval(updateStats, 250);
    updateStats();
    renderAll();
  }

  function renderAll() {
    if (!panel || !syncEngine || !typingEngine) return;
    const words = syncEngine.getDisplayWords();
    const charDiff = typingEngine.getCharDiff();
    const isPaused = syncEngine.isPausedByUs;
    panel.render(words, syncEngine.currentWordIndex, { charDiff, isPaused });
  }

  function updateStats() {
    if (!panel || !typingEngine) return;
    panel.updateStats(typingEngine.getStats());
  }

  // ========== Panel ==========

  function setupPanel() {
    if (panel) return;
    panel = new TypeStreamPanel();
    const ok = panel.mount();
    if (!ok) {
      panel = null;
      // Retry later
      setTimeout(setupPanel, 1000);
      return;
    }
    panel.on('close', () => teardown());
    panel.on('settingChange', (data) => {
      settings[data.key] = data.value;
      saveSettings();
      if (syncEngine) syncEngine.setOptions(settings);
      if (typingEngine) typingEngine.setOptions(settings);
    });
  }

  // ========== SPA Navigation ==========

  function watchForWatchPage() {
    document.addEventListener('yt-navigate-finish', () => {
      if (window.location.pathname.startsWith('/watch')) {
        // We're now on a watch page — full init
        window.location.reload();
      }
    });
  }

  // SPA navigation within /watch pages
  document.addEventListener('yt-navigate-finish', () => {
    const newId = getVideoId();
    if (newId && newId !== currentVideoId) {
      teardown();
      currentVideoId = newId;
      _captionsResolved = false;
      setupPanel();
      waitForVideo();
    }
  });

  // popstate backup
  window.addEventListener('popstate', () => {
    setTimeout(() => {
      const newId = getVideoId();
      if (newId && newId !== currentVideoId) {
        teardown();
        currentVideoId = newId;
        _captionsResolved = false;
        setupPanel();
        waitForVideo();
      }
    }, 500);
  });

  // ========== Teardown ==========

  function teardown() {
    if (syncEngine) { syncEngine.detach(); syncEngine = null; }
    if (typingEngine) { typingEngine.detach(); typingEngine = null; }
    if (panel) { panel.unmount(); panel = null; }
    if (_statsInterval) { clearInterval(_statsInterval); _statsInterval = null; }
    cues = [];
    isSessionActive = false;
  }

  // ========== Popup Messages ==========

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
        _captionsResolved = false;
        setupPanel();
        waitForVideo();
        sendResponse({ active: true });
      }
      return true;
    }
  });

})();
