// TypeStream - Background Service Worker
// Intercepts YouTube's timedtext API requests to capture the real subtitle URL.
// Fetches subtitle content for content scripts (bypass CORS).

let lastSubtitleUrl = null;
let lastSubtitleFetch = null;

// ---- Intercept YouTube's own timedtext requests ----
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.url.includes('/api/timedtext')) {
      lastSubtitleUrl = details.url;
      lastSubtitleFetch = Date.now();
      console.log('[TypeStream SW] Captured timedtext URL:', details.url.substring(0, 120));
    }
  },
  { urls: ['*://*.youtube.com/api/timedtext*'], types: ['xmlhttprequest', 'other'] }
);

// ---- Handle messages from content scripts ----
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_SUBTITLE_URL') {
    sendResponse({ url: lastSubtitleUrl, age: Date.now() - (lastSubtitleFetch || 0) });
    return true;
  }

  if (message.type === 'FETCH_SUBTITLES') {
    fetchSubtitles(message.url)
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

async function fetchSubtitles(url) {
  const resp = await fetch(url, {
    credentials: 'include',
    headers: { 'Accept': 'text/vtt, application/json, text/xml, */*' }
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return await resp.text();
}
