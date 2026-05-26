// TypeStream - Subtitle Parser
// Parses VTT and XML (timedtext) caption formats into cue objects.

(function(global) {
  'use strict';

  global.TypeStreamParser = {
    parseVTT,
    parseTimedText,
    autoDetect,
  };

  const CUE_REGEX = /^(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[.,](\d{3})/;

  /**
   * Parse WebVTT format.
   */
  function parseVTT(raw) {
    const lines = raw.split('\n');
    const cues = [];
    let i = 0;

    // Skip WEBVTT header
    while (i < lines.length && !CUE_REGEX.test(lines[i])) {
      i++;
    }

    while (i < lines.length) {
      const line = lines[i];
      const match = line.match(CUE_REGEX);

      if (match) {
        const startMs = toMs(
          parseInt(match[1]), parseInt(match[2]), parseInt(match[3]), parseInt(match[4])
        );
        const endMs = toMs(
          parseInt(match[5]), parseInt(match[6]), parseInt(match[7]), parseInt(match[8])
        );

        // Gather text lines until blank line or next cue
        i++;
        let text = '';
        while (i < lines.length && lines[i].trim() !== '' && !CUE_REGEX.test(lines[i])) {
          text += (text ? ' ' : '') + cleanVttLine(lines[i]);
          i++;
        }

        if (text.trim()) {
          cues.push({ startMs, endMs, text: text.trim() });
        }

        continue;
      }
      i++;
    }

    return cues;
  }

  /**
   * Parse YouTube timedtext XML format.
   */
  function parseTimedText(raw) {
    const cues = [];
    const parser = new DOMParser();
    const doc = parser.parseFromString(raw, 'text/xml');

    const errorNode = doc.querySelector('parsererror');
    if (errorNode) {
      // Try regex-based parsing as fallback
      const textRegex = /<text\s+start="([\d.]+)"\s+dur="([\d.]+)"[^>]*>([^<]*)<\/text>/g;
      let m;
      while ((m = textRegex.exec(raw)) !== null) {
        const startSec = parseFloat(m[1]);
        const durSec = parseFloat(m[2]);
        const text = decodeXmlEntities(m[3].trim());
        if (text) {
          cues.push({
            startMs: Math.round(startSec * 1000),
            endMs: Math.round((startSec + durSec) * 1000),
            text,
          });
        }
      }
      return cues;
    }

    const textNodes = doc.querySelectorAll('text');
    textNodes.forEach(node => {
      const startSec = parseFloat(node.getAttribute('start') || '0');
      const durSec = parseFloat(node.getAttribute('dur') || '0');
      const rawText = node.textContent || '';
      const decoded = decodeXmlEntities(rawText.trim());

      if (decoded) {
        cues.push({
          startMs: Math.round(startSec * 1000),
          endMs: Math.round((startSec + durSec) * 1000),
          text: decoded,
        });
      }
    });

    return cues;
  }

  function autoDetect(raw) {
    const trimmed = raw.trim();
    if (trimmed.startsWith('WEBVTT')) {
      return parseVTT(trimmed);
    }
    if (trimmed.startsWith('<?xml') || trimmed.startsWith('<timedtext') || trimmed.startsWith('<text')) {
      return parseTimedText(trimmed);
    }
    // fallback: try VTT
    return parseVTT(raw);
  }

  function toMs(h, m, s, ms) {
    return (h * 3600 + m * 60 + s) * 1000 + ms;
  }

  function cleanVttLine(line) {
    // Remove VTT tags like <c>, <i>, <b>, etc.
    let cleaned = line.replace(/<[^>]+>/g, '');
    // Remove speaker annotations like <v Joe>
    cleaned = cleaned.replace(/<\/?v[^>]*>/g, '');
    return cleaned;
  }

  function decodeXmlEntities(str) {
    return str
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&#x27;/g, "'");
  }

})(typeof globalThis !== 'undefined' ? globalThis : window);
