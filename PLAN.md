# ZehnTage Chrome Extension — Project Plan

Chrome extension port of [zehntage](https://github.com/30be/zehntage) nvim plugin.
Select text on any page, get a translation popup. Single words also get etymology
and an "Add to Anki" button that writes to the same TSV file nvim uses.

---

## Architecture Overview

```
┌─────────────┐    chrome.runtime    ┌───────────────┐    native msg    ┌─────────────┐
│ content.js  │ ◄──────────────────► │ background.js │ ◄──────────────► │  host.py    │
│             │    messags           │ (svc worker)  │                  │ (file I/O)  │
│ - selection │                      │ - Gemini API  │                  │ - read TSV  │
│ - popup UI  │                      │ - native msg  │                  │ - write TSV │
│ - highlight │                      │ - storage     │                  └─────────────┘
└─────────────┘                      └───────────────┘
       ▲
       │ injects
┌──────┴──────┐
│ content.css │
└─────────────┘

┌─────────────┐
│ popup.html  │  Extension toolbar popup (API key entry)
│ popup.js    │
│ popup.css   │
└─────────────┘
```

### Message flow: user selects text

1. `content.js` detects `mouseup` with non-empty selection
2. Sends `{ action: "translate", text, context, isSingleWord }` to background
3. `background.js` calls Gemini API via `fetch()`
4. Returns `{ translation, notes }` to content script
5. `content.js` renders popup near the selection

### Message flow: user clicks "Add to Anki"

1. `content.js` sends `{ action: "addWord", word, translation, notes, context }`
2. `background.js` writes to TSV via native messaging host
3. `background.js` updates `chrome.storage.local` word cache
4. `content.js` refreshes highlights on the page

---

## File Structure

```
zehntage-chrome/
├── manifest.json              # MV3 manifest
├── background.js              # Service worker: API calls, native messaging, storage
├── content.js                 # Content script: selection, popup, highlighting
├── content.css                # Popup and highlight styles
├── popup/
│   ├── popup.html             # API key entry UI
│   ├── popup.js
│   └── popup.css
├── native/
│   ├── install.sh             # Registers native messaging host
│   ├── uninstall.sh
│   └── zehntage_host.py       # Native messaging host (reads/writes TSV)
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Decision Points

> Items marked **[DECIDE]** — edit this file to lock in your choice before I build.

### [DECIDE] LLM Provider - Yeah keep flash lite.

Current choice: **Gemini 2.5 Flash Lite** (same as nvim plugin)
- Endpoint: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent`
- Auth: API key in header `x-goog-api-key`
- Cheap, fast, good enough for translation

Alternatives:
- `gemini-2.5-flash` — smarter, still cheap
- OpenAI `gpt-4o-mini` — different API format, needs different key
- Local Ollama — no API key needed, but user must run a server

### [DECIDE] File Sync Method - yeah, native messaging is the user friendliest version

Current choice: **Native messaging host** (Python script)
- Reads/writes `~/.local/share/nvim/zehntage_words.tsv` directly
- Seamless sync with nvim plugin — same file, same format
- Requires one-time install: `cd native && ./install.sh`
- ~60 lines of Python, no dependencies beyond stdlib

Alternatives:
- **Storage-only**: words live in `chrome.storage.local`, export via download button.
  Simpler (no native host install) but no automatic sync with nvim.
- **File System Access API**: browser prompts user to pick the TSV file.
  No install needed, but permission lost on browser restart.

### [DECIDE] TSV Path - keep it like that for now.

Current choice: `~/.local/share/nvim/zehntage_words.tsv` (hardcoded in host.py)

If you want it configurable, I can add a path setting in the popup UI and
pass it to the native host. Let me know.

### [DECIDE] Selection Trigger - yeah we need to be intrusive for minimal friction

Current choice: **mouseup** — tooltip appears automatically when you release
the mouse after selecting text. Dismissed on click-away.

Alternatives:
- **Context menu**: right-click → "Translate with ZehnTage" (less intrusive but slower)
- **Keyboard shortcut**: e.g. Ctrl+Shift+Z after selecting (most unobtrusive)
- **Mouseup + modifier**: only trigger when Shift/Alt is held during selection

### [DECIDE] Popup Style - floating tooltip is right

Current choice: **Floating tooltip** near the selection (mimics the nvim float).
Absolute-positioned div, rounded border, max-width 400px, closes on outside click.

Alternative:
- **Side panel**: Chrome side panel API, persistent, shows history.
  More complex, heavier.

### [DECIDE] Highlight Style - i think crimson red would fit better. Or lightish pink if colors are inverted

Current choice: **Blue underline** (`text-decoration: underline; color: #89b4fa`)
matching nvim's `ZehnTageWord` highlight group. Applied via CSS class on
`<mark>` elements wrapping matched words.

---

## Detailed Component Specs

### manifest.json

```json
{
  "manifest_version": 3,
  "name": "ZehnTage",
  "version": "0.1.0",
  "description": "Translate selected text, learn vocabulary, export to Anki",
  "permissions": [
    "storage",
    "nativeMessaging",
    "activeTab"
  ],
  "host_permissions": [
    "https://generativelanguage.googleapis.com/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"],
      "css": ["content.css"]
    }
  ],
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

### background.js

Core responsibilities:
- Listen for messages from content script
- Call Gemini API
- Communicate with native messaging host for file I/O
- Cache word list in `chrome.storage.local`

```js
// Gemini API call
async function callGemini(prompt) {
  const { apiKey } = await chrome.storage.local.get("apiKey");
  const resp = await fetch(GEMINI_URL + "?key=" + apiKey, {  // [DECIDE] key in URL vs header
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2 },
    }),
  });
  const data = await resp.json();
  const text = data.candidates[0].content.parts[0].text;
  return JSON.parse(text.replace(/^```json\s*/, "").replace(/```\s*$/, ""));
}

// Native messaging
function readWords() {
  return chrome.runtime.sendNativeMessage("com.zehntage.host", { action: "read" });
}
function writeWord(entry) {
  return chrome.runtime.sendNativeMessage("com.zehntage.host", { action: "write", entry });
}
```

**Prompts** — identical to nvim plugin:

Single word:
```
Translate the word "{word}" to English using context below.
Notes: max 15 words. Only something that helps memorize: etymology, word roots,
word structure, or a fun fact. No grammar info, no tense, no repeating context.
Empty string if nothing useful.
Examples:
- Kutsche→carriage: "From Hungarian kocsi, named after the town Kocs"
- Schmetterling→butterfly: "From Schmetten (cream) — butterflies were thought to steal milk"
- Angst→fear: "Same word borrowed into English as-is"
- Zeitgeist→spirit of the time: ""
Return ONLY valid JSON: {"translation":"...","notes":"..."}

Context:
{surrounding text on the page}
```

Multi-word selection:
```
You are a translator. Your ONLY job is to translate the exact text between the
delimiters below to English. Do NOT paraphrase, summarize, or translate any
other text. Return ONLY valid JSON: {"translation":"..."}

===BEGIN===
{selected text}
===END===
```

### content.js

**Selection detection:**
```js
document.addEventListener("mouseup", async (e) => {
  const sel = window.getSelection();
  const text = sel.toString().trim();
  if (!text) return;

  const isSingleWord = /^\S+$/.test(text);

  // Grab surrounding context: the text content of the parent block element
  const range = sel.getRangeAt(0);
  const container = range.commonAncestorContainer.parentElement.closest("p, div, li, td, article") || document.body;
  const context = container.textContent.substring(0, 500);

  // Position popup near selection
  const rect = range.getBoundingClientRect();
  showPopup(rect, "Loading...");

  const result = await chrome.runtime.sendMessage({
    action: "translate",
    text,
    context,
    isSingleWord,
  });

  renderResult(result, text, isSingleWord, rect);
});
```

**Popup rendering:**
```js
function renderResult(result, word, isSingleWord, rect) {
  // Main line: "word → translation"
  // If single word and notes exist: show notes on second line
  // If single word: show "Add to Anki" button
  // If word already in list: show "Already saved" instead
}
```

**Word highlighting:**
```js
async function highlightKnownWords() {
  const { words } = await chrome.storage.local.get("words");
  if (!words || !Object.keys(words).length) return;

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  // For each text node, check if it contains any known word (case-insensitive,
  // whole-word boundary). If so, wrap the match in <mark class="zehntage-word">.
}
```

Run on page load and after adding a new word.

### content.css

```css
/* Popup */
.zehntage-popup {
  position: fixed;
  z-index: 2147483647;
  max-width: 400px;
  padding: 12px 16px;
  background: #1e1e2e;
  color: #cdd6f4;
  border: 1px solid #45475a;
  border-radius: 8px;
  font-family: system-ui, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.zehntage-popup .word {
  font-weight: 700;
}

.zehntage-popup .notes {
  margin-top: 6px;
  font-size: 13px;
  color: #a6adc8;
  font-style: italic;
}

.zehntage-popup .btn-anki {
  margin-top: 8px;
  padding: 4px 12px;
  background: #89b4fa;
  color: #1e1e2e;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}

.zehntage-popup .btn-anki:hover {
  background: #b4d0fb;
}

/* Highlighted known words */
mark.zehntage-word {
  background: none;
  color: inherit;
  text-decoration: underline;
  text-decoration-color: #89b4fa;
  text-underline-offset: 2px;
}
```

### popup/popup.html

Dead simple — one input, one button:

```html
<!DOCTYPE html>
<html>
<head><link rel="stylesheet" href="popup.css"></head>
<body>
  <h3>ZehnTage</h3>
  <label>Gemini API Key</label>
  <input type="password" id="key" placeholder="paste key here">
  <button id="save">Save</button>
  <p id="status"></p>
  <script src="popup.js"></script>
</body>
</html>
```

popup.js loads existing key from `chrome.storage.local`, saves on button click.
Shows word count from the cached list.

### native/zehntage_host.py

Native messaging protocol: read 4-byte length prefix, then JSON. Write same format.

```python
#!/usr/bin/env python3
"""Native messaging host for ZehnTage Chrome extension.
Reads/writes ~/.local/share/nvim/zehntage_words.tsv
"""
import json, struct, sys, os

TSV_PATH = os.path.expanduser("~/.local/share/nvim/zehntage_words.tsv")

def read_message():
    raw_length = sys.stdin.buffer.read(4)
    if not raw_length:
        sys.exit(0)
    length = struct.unpack("=I", raw_length)[0]
    msg = sys.stdin.buffer.read(length).decode("utf-8")
    return json.loads(msg)

def send_message(obj):
    encoded = json.dumps(obj).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("=I", len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()

def read_words():
    words = {}
    if not os.path.exists(TSV_PATH):
        return words
    with open(TSV_PATH, "r") as f:
        first = True
        for line in f:
            if first:
                first = False
                continue
            parts = line.strip().split("|")
            if len(parts) >= 4:
                words[parts[0].lower()] = {
                    "back": parts[1],
                    "notes": parts[2],
                    "context": parts[3],
                }
    return words

def write_word(entry):
    # Read existing, merge, rewrite
    words = read_words()
    key = entry["front"].lower()
    words[key] = {
        "back": entry["back"],
        "notes": entry.get("notes", ""),
        "context": entry.get("context", ""),
    }
    with open(TSV_PATH, "w") as f:
        f.write("front|back|notes|context\n")
        for front, data in words.items():
            ctx = data["context"].replace("\n", " ")
            notes = data["notes"].replace("\n", " ")
            f.write(f"{front}|{data['back']}|{notes}|{ctx}\n")

def main():
    msg = read_message()
    if msg["action"] == "read":
        send_message({"words": read_words()})
    elif msg["action"] == "write":
        write_word(msg["entry"])
        send_message({"ok": True})

if __name__ == "__main__":
    main()
```

### native/install.sh

```bash
#!/bin/bash
# Installs native messaging host for ZehnTage Chrome extension
# [DECIDE] Extension ID — must be updated after first chrome://extensions load

EXT_ID="EXTENSION_ID_HERE"
HOST_NAME="com.zehntage.host"
HOST_PATH="$(cd "$(dirname "$0")" && pwd)/zehntage_host.py"
MANIFEST_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
# [DECIDE] Chromium path: ~/.config/chromium/NativeMessagingHosts for Chromium

mkdir -p "$MANIFEST_DIR"

cat > "$MANIFEST_DIR/$HOST_NAME.json" <<EOF
{
  "name": "$HOST_NAME",
  "description": "ZehnTage file I/O",
  "path": "$HOST_PATH",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
EOF

chmod +x "$HOST_PATH"
echo "Installed. Restart Chrome."
```

---

## Highlighting Strategy

On page load (`document.addEventListener("DOMContentLoaded", ...)`):

1. Load word list from `chrome.storage.local` (fast, no native message needed)
2. Build a single regex from all known words: `/\b(word1|word2|word3)\b/gi`
3. Walk all text nodes via `TreeWalker`
4. For each match, split the text node and wrap the match in `<mark class="zehntage-word">`
5. Use `MutationObserver` to re-highlight on dynamic content (SPAs)

**Performance note:** If the word list grows large (1000+), consider using a Set
for O(1) lookup per word token instead of a giant regex. Split each text node's
content into words and check against the Set.

---

## Context Extraction

The nvim plugin uses 3 surrounding lines. For a web page, we grab the text
content of the nearest block-level ancestor (`<p>`, `<div>`, `<li>`, `<td>`,
`<article>`), truncated to 500 chars. This gives the LLM enough context
to disambiguate without sending entire pages.

When saving to TSV, the context stores: text before selection + `<b>word</b>` +
text after, matching the nvim format for Anki card rendering.

---

## Edge Cases

- **Already-saved words**: When popup opens for a single word that's already in
  the list, show the cached translation immediately (no API call) and display
  "Already saved" instead of the Anki button.
- **Popup dismissal**: Click outside, press Escape, or start a new selection.
- **Multiple popups**: Only one popup at a time. New selection replaces old.
- **Iframes**: Content script won't run inside iframes unless `all_frames: true` -- i would like to actually run in all frames too.
  is set in manifest. Default: skip iframes.
- **Dark/light pages**: The popup uses its own dark theme (Catppuccin Mocha
  palette). [DECIDE] Or should it adapt to the page?

---

## What's NOT Included (keeping it dead simple)

- No options page beyond the popup API key input
- No sync across devices (just local file)
- No Anki integration beyond the TSV file (no AnkiConnect)
- No translation history/log in the extension
- No configurable keybindings
- No per-site enable/disable

---

## Build & Install

No build step. Load as unpacked extension:

1. `git clone` / copy files
2. `chrome://extensions` → Enable Developer Mode → Load Unpacked → select folder
3. Copy extension ID from the card
4. Edit `native/install.sh`, paste the ID
5. Run `cd native && ./install.sh`
6. Click extension icon → paste Gemini API key → Save
7. Open any page, select text, see translation

---

## Summary Checklist

- [ ] manifest.json
- [ ] background.js (Gemini API + native messaging bridge)
- [ ] content.js (selection detection, popup, highlighting)
- [ ] content.css (popup + highlight styles)
- [ ] popup/popup.html + popup.js + popup.css
- [ ] native/zehntage_host.py
- [ ] native/install.sh + uninstall.sh
- [ ] icons (can use simple placeholder PNGs initially)
