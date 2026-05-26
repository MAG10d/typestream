// TypeStream - MAIN World Content Script
// Injected at document_start with "world": "MAIN" to access ytInitialPlayerResponse.

(function() {
  'use strict';

  const TS_MSG = 'TYPESTREAM_MAIN_WORLD';

  function notifyIsolated(data) {
    window.postMessage({ source: TS_MSG, payload: data }, '*');
  }

  /**
   * Extracts caption tracks from ytInitialPlayerResponse, trying multiple paths.
   */
  function extractCaptions() {
    const yt = window.ytInitialPlayerResponse;
    if (!yt) return null;

    // Path 1: yt.captions.playerCaptionsTracklistRenderer (classic)
    // Path 2: yt.playerResponse.captions
    // Path 3: yt.playerResponse.captions.playerCaptionsTracklistRenderer
    let captions = yt.captions;
    if (!captions && yt.playerResponse) {
      captions = yt.playerResponse.captions;
    }
    if (!captions) {
      // Path 4: the response might have caption data nested differently
      return { tracks: [], videoId: getVideoId(yt), title: getTitle(yt), debug: 'no captions in ytInitialPlayerResponse' };
    }

    const renderer = captions.playerCaptionsTracklistRenderer;
    if (!renderer || !renderer.captionTracks || !renderer.captionTracks.length) {
      return { tracks: [], videoId: getVideoId(yt), title: getTitle(yt), debug: 'no captionTracks in renderer' };
    }

    const tracks = renderer.captionTracks.map(t => ({
      baseUrl: t.baseUrl,
      languageCode: t.languageCode,
      name: (t.name && t.name.simpleText) ? t.name.simpleText : '',
      kind: t.kind || '',
      isTranslatable: t.isTranslatable || false,
      vssId: t.vssId || '',
    }));

    return { tracks, videoId: getVideoId(yt), title: getTitle(yt) };
  }

  function getVideoId(yt) {
    return (yt.videoDetails && yt.videoDetails.videoId) || '';
  }

  function getTitle(yt) {
    return (yt.videoDetails && yt.videoDetails.title) || '';
  }

  function findBestEnglishTrack(tracks) {
    const en = tracks.filter(t => t.languageCode === 'en');
    if (!en.length) return null;
    const manual = en.find(t => t.kind !== 'asr');
    return manual || en[0];
  }

  function sendData() {
    const data = extractCaptions();
    if (!data) {
      notifyIsolated({
        type: 'CAPTIONS_DATA', tracks: [], bestTrack: null,
        videoId: '', title: '', debug: 'ytInitialPlayerResponse undefined',
      });
      return false;
    }
    const best = findBestEnglishTrack(data.tracks);
    notifyIsolated({
      type: 'CAPTIONS_DATA', tracks: data.tracks, bestTrack: best,
      videoId: data.videoId, title: data.title,
      debug: data.tracks.length === 0
        ? (data.debug || 'no caption tracks found')
        : data.tracks.map(t => t.languageCode).join(', '),
    });
    return data.tracks.length > 0;
  }

  // Respond to ISOLATED world requests
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== TS_MSG) return;
    if (msg.type === 'REQUEST_CAPTIONS') sendData();
  });

  // Poll: ytInitialPlayerResponse may not be available immediately at document_start
  let attempts = 0;
  function poll() {
    const success = sendData();
    attempts++;
    if (!success && attempts < 60) {
      // 60 attempts × 500ms = 30 seconds total
      setTimeout(poll, 500);
    }
  }
  poll();

})();
