# NET-Trans

A browser extension for translating between **English**, **Nepali**, and **Tamang** — built for the **Google TMT Hackathon 2026**.

NET-Trans goes beyond literal translation: it explains cultural nuances, detects idioms, breaks down grammar, and helps you build vocabulary as you browse.

## Features

- **Smart Select** — Highlight text on any page to get a translation with grammar breakdown, synonyms, and idiom detection.
- **Cultural Context** — Flags culturally significant words (*Dai*, *Hajur*, *Lama*) with usage notes.
- **Full Page Translation** — Translates the entire page without breaking layout. Hover to see the original text.
- **YouTube Subtitle Translation** — Translates video captions in real time with a toggle button inside the player.
- **Personal Dictionary & Quiz** — Save words and practice them with a built-in spaced-repetition quiz.
- **Glossary Overlay** — Highlights complex vocabulary on any page with hover-to-translate definitions.
- **Privacy First** — API keys stay in the background service worker and are never exposed to page scripts.

## Demo

[Watch the demo video (Google Drive)](https://drive.google.com/drive/folders/1HSGep7FiDl8aBYx5yGNMln_dnQCeWWY5?usp=sharing)

## Installation

### Chrome
1. Clone or download this repository.
2. Go to `chrome://extensions/` and enable **Developer mode**.
3. Click **Load unpacked** and select the project folder.
4. Pin the extension for easy access.

### Firefox
1. Go to `about:debugging` → **This Firefox** → **Load Temporary Add-on**.
2. Select `manifest.json` from the project folder.

### API Key Setup
To make it work, you'll need an API key from the Information and Language processing Research Lab (ILPRL) - Kathmandu University:
1. Click the NET-Trans icon → **Settings** (gear icon).
2. Paste your TMT API key and click **Save**.

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+T` | Translate / restore page |
| `Ctrl+Shift+Y` | Translate selected text |
| `Escape` | Close translation popup |

## Project Structure

```
NET-trans/
├── manifest.json          # Manifest V3 config
├── background.js          # Service worker — API calls, caching, message routing
├── content.js             # Page injection — popups, toasts, page/YT translation
├── content.css            # Styles for injected UI elements
├── logo.png               # Extension icon
├── lib/
│   ├── translator.js      # Translation engine, cultural notes, grammar, synonyms
│   ├── glossary.js        # Glossary overlay — highlights & translates vocabulary
│   └── yt-caption-bridge.js  # Extracts YouTube caption tracks from page context
├── popup/
│   ├── popup.html         # Extension popup UI
│   ├── popup.css          # Popup styles
│   └── popup.js           # Popup logic — translate, dictionary, quiz, history
└── options/
    ├── options.html        # Settings page UI
    ├── options.css         # Settings styles
    └── options.js          # Settings logic — API key, preferences, data management
```

## Tech Stack

- **Manifest V3** — Chrome extension architecture
- **Google TMT API** — Translation backend for EN ↔ NE ↔ TMG
- **Vanilla JS/CSS** — No frameworks, no build step

---

Built for the Google TMT Hackathon 2026 by the NET-Trans team.
