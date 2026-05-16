# ZehnTage Chrome Extension

Translate selected text on any page, learn vocabulary, export to Anki.
Chrome port of the [zehntage](https://github.com/30be/zehntage) nvim plugin.

## Install

1. Clone the repo
2. Open `chrome://extensions` (or `brave://extensions`)
3. Enable **Developer Mode** → **Load Unpacked** → select the repo folder
4. Click the ZehnTage icon → paste your Gemini API key, your Anki MCP URL,
   and your Anki key → Save

## Usage

Select text on any page — a popup appears with the translation.

- **Single word**: shows translation + etymology + "Add to Anki" button
- **Multi-word selection**: shows translation only
- **Already saved words**: highlighted with a red underline; selecting shows cached translation

### Site filtering

By default the extension is active on all sites. To restrict it, open the
popup and add URL patterns (one regex per line) under "Active sites".

### PDFs

The browser's built-in PDF viewer doesn't expose text to extensions.
To use ZehnTage with PDFs, open them through Mozilla's online PDF.js viewer:

```
https://mozilla.github.io/pdf.js/web/viewer.html?file=PDF_URL
```

This renders the PDF as HTML, so text selection and translation work normally.
Note: some PDF servers may block cross-origin requests.

## Anki integration

Words are saved to a remote **anki-mcp** server. When you add a word, the
extension sends the card to the server, which stores it in Anki. The same
server backs the word list shown as highlights and powers the **Delete**
button on already-saved words.

Configure it in the extension popup:

- **Anki MCP URL** — the base URL of your anki-mcp server. A trailing
  `/mcp` (and any trailing slash) is stripped automatically, so you can
  paste the MCP endpoint directly.
- **Anki Key** — the secret key sent with every request as the
  `X-Zehntage-Key` header.

If the URL or key is unset, or the server is unreachable, the extension
falls back to its locally cached word list (highlighting still works, but
adding and deleting words will not).