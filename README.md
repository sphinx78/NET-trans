# NET-Trans 

Hey there! Welcome to **NET-Trans**. We built this browser extension for the **Google TMT Hackathon 2026** because we wanted a better way to bridge the gap between English, Nepali, and Tamang on the web. 

Most translation tools give you robotic, literal translations. We wanted something smarter.. something that understands context, explains cultural nuances, and even helps you learn the language while you browse.

---

## What does it actually do?

NET-Trans isn't just a basic translator. Here's what we packed into it:

- **Smart Select (The core feature):** Highlight any text on a webpage. Instead of just translating it, we give you a grammar breakdown, synonyms, and even flag if the phrase is an idiom (so you don't literally translate "break a leg").
- **Cultural Context:** If a word holds cultural weight in Nepali or Tamang (like *Lama*, *Dai*, or *Hajur*), we explain what it actually means and when to use it respectfully.
- **Full Page Translation:** Reads the DOM and translates the whole page without breaking the layout. You can even hover over the translated text to peek at the original.
- **Personal Dictionary & Quiz:** See a word you want to remember? Save it to your dictionary. We included a spaced-repetition quiz built right into the extension so you can practice your vocabulary later.
- **Privacy First:** Your API keys stay entirely inside the background service worker. Content scripts never see them. 

---

## Getting Started

Want to test it out? Here's how to load it locally:

1. Clone or download this repository.
2. Open Chrome and go to `chrome://extensions/`.
3. Toggle **Developer mode** on in the top right corner.
4. Click **Load unpacked** and select the `linguist-ai` folder.
5. Pin the extension up top for easy access!

*Note for Firefox users: Go to `about:debugging` -> This Firefox -> Load Temporary Add-on -> select the `manifest.json`.*

### Setting up the TMT API
To make it work, you'll need an API key from the Nepal TMT API:
1. Click the NET-Trans icon and hit the Settings gear.
2. Paste your API key in the general settings tab.
3. Click Save, and you're good to go!

---

## Keyboard Shortcuts

If you prefer using the keyboard:
- `Ctrl + Shift + T` : Translate the entire page (or restore it back to original)
- `Ctrl + Shift + Y` : Translate whatever text you currently have highlighted
- `Escape` : Quickly close the translation popup

---

## How we built it

We wanted to keep the codebase lightweight and secure. Here's a quick look under the hood:

- **`manifest.json`**: Standard Manifest V3 setup.
- **`background.js`**: The brains of the operation. This handles all the state, the in-memory caching (so we don't spam the API), and securely makes the network requests.
- **`content.js`**: Injects our UI (the popups, toasts, and hover effects) directly into webpages. We use isolated classes to make sure we don't mess up the host website's CSS.
- **`lib/translator.js`**: Where the language logic lives—handling API requests, grammar tagging, synonym mapping, and detecting if you're reading a technical doc or a casual blog.

---

Built for the TMT Hackathon 2026. If you have any questions about the code, feel free to reach out!
