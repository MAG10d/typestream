// TypeStream - Background Service Worker
// Subtitle fetch proxy (bypass CORS when direct fetch fails).

const VTT_CACHE = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'FETCH_SUBTITLES') {
    fetchSubtitles(message.url)
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

async function fetchSubtitles(url) {
  const cacheKey = url;
  const cached = VTT_CACHE.get(cacheKey);
  if (cached) return cached;

  const resp = await fetch(url, { headers: { 'Accept': 'text/vtt, application/json, text/xml, */*' } });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const text = await resp.text();

  VTT_CACHE.set(cacheKey, text);
  if (VTT_CACHE.size > 50) VTT_CACHE.delete(VTT_CACHE.keys().next().value);
  return text;
}
