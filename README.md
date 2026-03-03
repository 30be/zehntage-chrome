# ZehnTage Chrome Extension

Translate selected text on any page, learn vocabulary, export to Anki.
Chrome port of the [zehntage](https://github.com/30be/zehntage) nvim plugin.

## Install

1. Clone the repo
2. Open `chrome://extensions` (or `brave://extensions`)
3. Enable **Developer Mode** → **Load Unpacked** → select the repo folder
4. Copy the extension ID from the card
5. Install the native messaging host:
   ```
   cd native && ./install.sh <extension-id>
   ```
6. Restart the browser
7. Click the ZehnTage icon → paste your Gemini API key → Save

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

Words are saved in two ways:

1. **AnkiConnect** (if Anki is running with the [AnkiConnect](https://ankiweb.net/shared/info/2055492159) addon) — cards go directly into a "ZehnTage" deck
2. **TSV file** (`~/.local/share/nvim/zehntage_words.tsv`) — same file the nvim plugin uses, importable into Anki manually

Both are written simultaneously. If Anki isn't running, only the TSV file is used.