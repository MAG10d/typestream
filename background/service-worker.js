// TypeStream - Background Service Worker
// Acts as subtitle fetch proxy to bypass YouTube CORS restrictions.

const VTT_CACHE = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'FETCH_SUBTITLES') {
    fetchSubtitles(message.url)
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // keep channel open for async
  }
});

async function fetchSubtitles(url) {
  const cacheKey = url;
  const cached = VTT_CACHE.get(cacheKey);
  if (cached) return cached;

  const response = await fetch(url, {
    headers: {
      'Accept': 'text/vtt, application/xml, text/plain, */*',
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const text = await response.text();

  VTT_CACHE.set(cacheKey, text);

  // Basic cache eviction: keep under 50 entries
  if (VTT_CACHE.size > 50) {
    const firstKey = VTT_CACHE.keys().next().value;
    VTT_CACHE.delete(firstKey);
  }

  return text;
}
