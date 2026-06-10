# Changelog

## 0.1.3

- Gemini prompts now include the page URL (`Page URL: ...`, capped at 200
  chars) alongside the surrounding context, for both single-word and phrase
  lookups.

## 0.1.2

Firefox (desktop & Android) support, from the single Chrome MV3 source via
`build-firefox.sh` (generates the Gecko manifest, zips/signs the `.xpi`).

Mobile (touch devices, gated by `matchMedia` — desktop/Chrome unchanged):

- Popup renders as a bottom sheet (slide-up, ⚙ settings, ✕ close).
- `selectionchange` trigger, since long-press gives no reliable `mouseup`.
- In-page settings form, plus an auto-prompt when no Gemini key is set.
- `options_ui` page so settings are reachable from `about:addons`.
- Multi-word selection is preserved (the native selection toolbar overlaps the
  sheet — it's an OS/GeckoView overlay that CSS `z-index` cannot cover).
- Removed the decorative, off-center drag-grip from the sheet header.

## 0.1.0

Initial Chrome/Brave extension: translate selected text, learn vocabulary,
export to Anki; reference notes, named-entity bios, and Discuss.
