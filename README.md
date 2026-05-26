# ⌨ TypeStream

**Practice touch-typing with real-time YouTube subtitles.** Type along with any video that has English captions — MonkeyType meets YouTube.

## Features

- 🎬 **Real-time Subtitle Sync** — Subtitles are fetched from YouTube's timedtext API and synced to video playback in real time
- ⌨️ **MonkeyType-style UI** — Word-by-word color feedback: untyped (grey), correct (white), incorrect (red), current word (yellow cursor)
- ⏸️ **Auto-Pause** — Video automatically pauses when you fall behind, resumes when you catch up
- 🎯 **Strict & Flow Modes** — Strict mode requires typing every word; Flow mode skips ahead after a configurable timeout
- 📊 **Live Stats** — Rolling WPM, accuracy %, words completed, and session timer
- 🔍 **Seek Support** — Scrubbing the video instantly jumps the typing cursor to the correct subtitle position
- 🎨 **Shadow DOM Isolation** — All UI is injected inside Shadow DOM to prevent CSS conflicts with YouTube
- ⚙️ **Configurable** — Toggle auto-pause, ignore punctuation/case, adjust lag threshold, font size

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **Developer mode** (toggle in top right)
4. Click **Load unpacked** and select the `typestream/` folder
5. Open any YouTube video with English captions — the TypeStream panel appears below the player

## How to Use

1. **Open a YouTube video** that has English subtitles (CC button available)
2. The TypeStream panel appears below the video player automatically
3. **Click the panel** to focus and start typing
4. Type words as they appear — match the subtitle text in sync with the video
5. **Press `Esc`** to unfocus and use normal YouTube keyboard shortcuts
6. **Click `⚙`** to open settings and customize your experience

## Keyboard Handling

When the TypeStream panel is focused, it intercepts keystrokes to prevent YouTube's native shortcuts from triggering:
- Space (play/pause), K (pause), J/L (seek), F (fullscreen), M (mute), arrow keys, and number keys are all blocked from reaching YouTube
- Press `Esc` to release focus and restore normal YouTube keyboard behavior

## Project Structure

```
typestream/
├── manifest.json              # MV3 manifest
├── background/
│   └── service-worker.js      # Subtitle fetch proxy (bypass CORS)
├── content/
│   ├── index.js               # MAIN world: extracts ytInitialPlayerResponse
│   ├── isolated.js            # ISOLATED world: orchestrator & SPA navigation
│   ├── subtitleParser.js      # VTT / JSON3 parser
│   ├── syncEngine.js          # Video-to-cue sync & auto-pause logic
│   ├── typingEngine.js        # Keyboard input, word matching, stats
│   └── ui/
│       ├── styles.js          # MonkeyType dark theme (Shadow DOM)
│       └── panel.js           # Shadow DOM UI components
├── popup/
│   ├── popup.html
│   └── popup.js
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Known Limitations

- **YouTube Shorts not supported** — Shorts use a different player structure without standard timedtext captions
- **English captions only** — Currently only English subtitle tracks are extracted
- **Chrome only** — Extension uses MV3 APIs (`world: "MAIN"`, `chrome.storage`) not available in Firefox
- **json3 format preferred** — Falls back to VTT parsing if json3 fails, but VTT parsing may miss some timing data
- **Auto-generated captions** — The extension prefers manual captions over auto-generated, but falls back to auto-generated if no manual ones exist

## Development

### Architecture

- **MAIN world script** (`content/index.js`): Injecte at `document_start` to access `window.ytInitialPlayerResponse` before YouTube's scripts modify it. Communicates with ISOLATED world via `window.postMessage`.
- **ISOLATED world scripts** (`content/isolated.js` + modules): Handles DOM manipulation, Shadow DOM injection, typing engine, and sync engine. Cannot access `ytInitialPlayerResponse` directly.
- **Background service worker**: Fetches subtitle files (VTT/JSON) to bypass CORS restrictions that block content script fetch requests to YouTube's timedtext API.
- **SPA Navigation**: Listens to `yt-navigate-finish` custom event + `MutationObserver` on `<title>` to detect YouTube's SPA navigations and reinitialize the extension.

### SPA Navigation Handling

YouTube is a Single Page Application — navigating between videos doesn't trigger a full page reload. TypeStream handles this by:
1. Listening to `yt-navigate-finish` (YouTube's custom event)
2. Monitoring `<title>` changes via `MutationObserver`
3. Handling `popstate` for browser back/forward

On each navigation, the extension tears down the old session and reinitializes with the new video's subtitles.

### CSS Isolation

All TypeStream UI is rendered inside a **Shadow DOM** (`attachShadow({ mode: 'closed' })`). This means:
- YouTube's CSS cannot affect TypeStream's styling
- TypeStream's CSS cannot leak into YouTube's page
- Google Fonts are loaded via `@import` inside the Shadow DOM style element

## License

MIT
