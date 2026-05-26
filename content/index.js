// TypeStream - MAIN World Content Script
// Injected at document_start with "world": "MAIN" to access ytInitialPlayerResponse.

(function() {
  'use strict';

  const TS_MSG = 'TYPESTREAM_MAIN_WORLD';

  function notifyIsolated(data) {
    window.postMessage({ source: TS_MSG, payload: data }, '*');
  }

  function getVideoId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('v') || '';
  }

  function getTitle() {
    return document.title || '';
  }

  function extractCaptions() {
    const yt = window.ytInitialPlayerResponse;
    if (!yt) return null;

    let captions = yt.captions;
    if (!captions && yt.playerResponse) {
      captions = yt.playerResponse.captions;
    }

    if (!captions) {
      return { tracks: [], videoId: getVideoId(), title: getTitle(), debug: 'null captions' };
    }

    const renderer = captions.playerCaptionsTracklistRenderer;
    if (!renderer || !renderer.captionTracks || !renderer.captionTracks.length) {
      return { tracks: [], videoId: getVideoId(), title: getTitle(), debug: 'empty captionTracks' };
    }

    const tracks = renderer.captionTracks.map(t => ({
      baseUrl: t.baseUrl,
      languageCode: t.languageCode,
      name: (t.name && t.name.simpleText) ? t.name.simpleText : '',
      kind: t.kind || '',
      isTranslatable: t.isTranslatable || false,
      vssId: t.vssId || '',
    }));

    return { tracks, videoId: getVideoId(), title: getTitle() };
  }

  function findBestEnglishTrack(tracks) {
    const en = tracks.filter(t => t.languageCode === 'en');
    if (!en.length) return null;
    const manual = en.find(t => t.kind !== 'asr');
    return manual || en[0];
  }

  function sendData() {
    const data = extractCaptions();
    const best = data ? findBestEnglishTrack(data.tracks) : null;
    notifyIsolated({
      type: 'CAPTIONS_DATA',
      tracks: data ? data.tracks : [],
      bestTrack: best || null,
      videoId: data ? data.videoId : getVideoId(),
      title: data ? data.title : getTitle(),
      debug: data
        ? (data.tracks.length > 0 ? data.tracks.map(t => t.languageCode).join(',') : (data.debug || 'no tracks'))
        : 'no ytInitialPlayerResponse',
    });
    return data && data.tracks.length > 0;
  }

  // Respond to ISOLATED world requests
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.source !== TS_MSG) return;
    if (event.data.type === 'REQUEST_CAPTIONS') sendData();
  });

  // Poll until ytInitialPlayerResponse is ready
  let attempts = 0;
  function poll() {
    sendData();
    attempts++;
    if (attempts < 60) setTimeout(poll, 500);
  }
  poll();

})();
