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
      // No caption tracks found — try direct timedtext with videoId
      const vid = data.videoId || getVideoId();
      if (vid) {
        console.log('[TypeStream] No tracks, trying direct timedtext for', vid);
        const directUrl = 'https://www.youtube.com/api/timedtext?v=' + vid + '&lang=en&fmt=vtt';
        const text = await fetchViaSW(directUrl);
        if (text) cues = TypeStreamParser.autoDetect(text);
        if (cues && cues.length > 0) {
          initializeSession();
          return;
        }
      }
      if (panel) panel.showNoCaptions(data.title);
      return;
    }

    const track = data.bestTrack;

    // Strategy: ask background SW for the REAL intercepted timedtext URL
    // YouTube's own request has all the right params that we can't synthesize
    let realUrl = null;
    // Retry up to 3 times with 1.5s delay - YouTube player may not have requested captions yet
    for (let i = 0; i < 3; i++) {
      try {
        const swResponse = await chrome.runtime.sendMessage({ type: 'GET_SUBTITLE_URL' });
        realUrl = swResponse && swResponse.url;
        if (realUrl) {
          console.log('[TypeStream] Got real timedtext URL from SW (age:', swResponse.age, 'ms, attempt:', i+1, ')');
          break;
        }
        if (i < 2) {
          console.log('[TypeStream] SW has not captured timedtext URL yet, retrying in 1.5s (attempt:', i+1, ')');
          await new Promise(r => setTimeout(r, 1500));
        }
      } catch (e) {
        console.log('[TypeStream] SW URL error:', e.message, '(attempt:', i+1, ')');
        if (i < 2) await new Promise(r => setTimeout(r, 1500));
      }
    }

    // Fallback to building from baseUrl
    let fetchUrl = realUrl;
    if (!fetchUrl && track.baseUrl) {
      // Clean the baseUrl: remove 'exp' parameter and set hl to the track's languageCode
      let url;
      try {
        url = new URL(track.baseUrl.startsWith('http') ? track.baseUrl : 'https://www.youtube.com' + track.baseUrl);
      } catch (e) {
        // If URL construction fails, fall back to original method
        url = null;
      }
      if (url) {
        url.searchParams.delete('exp');
        // Set hl to the track's languageCode to match the caption language
        url.searchParams.set('hl', track.languageCode);
        // Add fmt=json3 to match the original behavior (we try json3 first, then vtt fallback)
        url.searchParams.set('fmt', 'json3');
        fetchUrl = url.toString();
      } else {
        // Fallback to original method if URL construction fails
        fetchUrl = (track.baseUrl.startsWith('http') ? track.baseUrl : 'https://www.youtube.com' + track.baseUrl) + '&fmt=json3';
      }
    }
    if (!fetchUrl) {
      const vid = data.videoId || getVideoId();
      if (vid) {
        // Also clean the fallback URL: set hl to track's languageCode and fmt=json3
        let url = new URL('https://www.youtube.com/api/timedtext');
        url.searchParams.set('v', vid);
        url.searchParams.set('lang', track.languageCode || 'en');
        url.searchParams.set('fmt', 'json3');
        fetchUrl = url.toString();
      }
    }

    if (!fetchUrl) {
      if (panel) panel.showNoCaptions(data.title);
      return;
    }

    console.log('[TypeStream] Fetching:', fetchUrl.substring(0, 150));

    // Fetch via background SW (bypasses CORS, has proper context)
    let text = await fetchViaSW(fetchUrl);

    if (text) {
      // Try parsing as json3 first
      try {
        cues = parseJson3Cues(JSON.parse(text));
      } catch (e) {
        // Try VTT
        cues = TypeStreamParser.autoDetect(text);
      }
    }

    // If still no cues, try VTT fallback
    if ((!cues || cues.length === 0) && fetchUrl.includes('json3')) {
      const vttUrl = fetchUrl.replace('json3', 'vtt');
      text = await fetchViaSW(vttUrl);
      if (text) cues = TypeStreamParser.autoDetect(text);
    }

    // Last resort: direct timedtext with videoId
    if ((!cues || cues.length === 0)) {
      const vid = data.videoId || getVideoId();
      if (vid) {
        const directUrl = 'https://www.youtube.com/api/timedtext?v=' + vid + '&lang=en&fmt=vtt';
        text = await fetchViaSW(directUrl);
        if (text) cues = TypeStreamParser.autoDetect(text);
      }
    }

    if (cues && cues.length > 0) {
      console.log('[TypeStream] Parsed', cues.length, 'cues');
      initializeSession();
    } else {
      console.log('[TypeStream] No cues after all fetch attempts');
      if (panel) panel.showNoCaptions(data.title);
    }
  }

  async function fetchViaSW(url) {
    // Try direct fetch from content script (has page cookies, same-origin)
    try {
      const resp = await fetch(url, { credentials: 'include' });
      if (resp.ok) {
        const text = await resp.text();
        if (text.length > 0) {
          console.log('[TypeStream] Direct fetch OK:', text.length, 'bytes');
          return text;
        }
        console.log('[TypeStream] Direct fetch empty body, trying SW...');
      } else {
        console.log('[TypeStream] Direct fetch status:', resp.status, 'trying SW...');
      }
    } catch (e) {
      console.log('[TypeStream] Direct fetch error:', e.message, 'trying SW...');
    }

    // Fallback: background SW (may not have cookies, but works as last resort)
    try {
      const response = await chrome.runtime.sendMessage({ type: 'FETCH_SUBTITLES', url });
      if (response && response.success && response.data && response.data.length > 0) {
        console.log('[TypeStream] SW fetch OK:', response.data.length, 'bytes');
        return response.data;
      }
      console.log('[TypeStream] SW fetch:', response?.success ? '0 bytes' : 'failed');
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
