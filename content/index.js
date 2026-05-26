// TypeStream - MAIN World Content Script
// Injected at document_start with "world": "MAIN" to access window.ytInitialPlayerResponse.

(function() {
  'use strict';

  const TS_MSG = 'TYPESTREAM_MAIN_WORLD';

  /**
   * Polls for ytInitialPlayerResponse and extracts caption tracks.
   * Sends result back to ISOLATED world via window.postMessage.
   */
  function extractCaptions() {
    const yt = window.ytInitialPlayerResponse;
    if (!yt || !yt.captions) {
      return null;
    }

    const captions = yt.captions;
    const renderer = captions.playerCaptionsTracklistRenderer;
    if (!renderer || !renderer.captionTracks || !renderer.captionTracks.length) {
      return { tracks: [], translationLanguages: [] };
    }

    const tracks = renderer.captionTracks.map(t => ({
      baseUrl: t.baseUrl,
      languageCode: t.languageCode,
      name: t.name ? t.name.simpleText || '' : '',
      kind: t.kind || '',           // 'asr' = auto-generated, empty = manual
      isTranslatable: t.isTranslatable || false,
      vssId: t.vssId || '',
    }));

    return {
      tracks,
      videoId: yt.videoDetails ? yt.videoDetails.videoId : '',
      title: yt.videoDetails ? yt.videoDetails.title : '',
    };
  }

  /**
   * Finds the best English subtitle track (prefers manual over auto).
   */
  function findBestEnglishTrack(tracks) {
    const englishTracks = tracks.filter(t => t.languageCode === 'en');
    if (!englishTracks.length) return null;

    const manual = englishTracks.find(t => t.kind !== 'asr');
    return manual || englishTracks[0];
  }

  function notifyIsolated(data) {
    window.postMessage({ source: TS_MSG, payload: data }, '*');
  }

  /**
   * Respond to ISOLATED world requests.
   */
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== TS_MSG) return;

    if (msg.type === 'REQUEST_CAPTIONS') {
      const data = extractCaptions();
      if (data && data.tracks.length) {
        const best = findBestEnglishTrack(data.tracks);
        notifyIsolated({
          type: 'CAPTIONS_DATA',
          tracks: data.tracks,
          bestTrack: best,
          videoId: data.videoId,
          title: data.title,
        });
      } else {
        notifyIsolated({
          type: 'CAPTIONS_DATA',
          tracks: [],
          bestTrack: null,
          videoId: data.videoId || '',
          title: data.title || '',
        });
      }
    }
  });

  // Also try to extract on load (for initial page load before ISOLATED asks)
  function tryNotifyReady() {
    const data = extractCaptions();
    if (data && data.tracks.length) {
      const best = findBestEnglishTrack(data.tracks);
      notifyIsolated({
        type: 'CAPTIONS_DATA',
        tracks: data.tracks,
        bestTrack: best,
        videoId: data.videoId,
        title: data.title,
      });
    }
  }

  // Try multiple times as ytInitialPlayerResponse may appear after our script runs
  let attempts = 0;
  function poll() {
    const data = extractCaptions();
    if (data && data.tracks.length) {
      const best = findBestEnglishTrack(data.tracks);
      notifyIsolated({
        type: 'CAPTIONS_DATA',
        tracks: data.tracks,
        bestTrack: best,
        videoId: data.videoId,
        title: data.title,
      });
      return;
    }
    attempts++;
    if (attempts < 30) {
      setTimeout(poll, 500);
    } else {
      notifyIsolated({
        type: 'CAPTIONS_DATA',
        tracks: [],
        bestTrack: null,
        videoId: '',
        title: '',
      });
    }
  }

  poll();

})();
