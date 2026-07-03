let popup = null;

// In-memory caches, keyed by selected text. Per page — cleared on reload.
const lookupCache = {};
let knownWords = {};
let enabled = false;
// True once a Gemini API key is stored — gates lookups and offers settings.
let apiKeyPresent = false;
// Anchor rect of the most recent popup, so the sheet's gear can reopen settings.
let lastRect = null;

// Phones/tablets: coarse pointer, no hover. Drives the bottom-sheet UI and a
// selectionchange-based trigger (mobile text selection doesn't fire mouseup the
// way a desktop mouse gesture does).
function isMobile() {
  return window.matchMedia("(hover: none) and (pointer: coarse)").matches;
}

// Which stored key gates the currently selected provider.
function hasKeyForProvider(provider, keys) {
  if (provider === "groq") return !!keys.groqApiKey;
  if (provider === "claude") return !!keys.claudeApiKey;
  if (provider === "cerebras") return !!keys.cerebrasApiKey;
  return !!keys.apiKey;
}

// --- Site filtering ---

async function checkSiteEnabled() {
  const { sitePatterns } = await chrome.storage.local.get("sitePatterns");
  if (!sitePatterns || sitePatterns.length === 0) {
    enabled = true;
    return;
  }
  const url = window.location.href;
  enabled = sitePatterns.some((pattern) => {
    try {
      return new RegExp(pattern).test(url);
    } catch {
      return false;
    }
  });
}

// --- Popup management ---

function removePopup() {
  if (popup) {
    popup.remove();
    popup = null;
  }
}

function createPopup(rect, html) {
  removePopup();
  lastRect = rect;
  const mobile = isMobile();

  popup = document.createElement("div");
  popup.className = "zehntage-popup";

  if (mobile) {
    // Bottom sheet: a grip, a settings gear, and a close button on top.
    popup.classList.add("zehntage-popup--sheet");
    popup.innerHTML =
      '<div class="zehntage-sheet-header">' +
      '<span class="zehntage-header-actions">' +
      '<button class="zehntage-gear" title="Settings" aria-label="Settings">⚙</button>' +
      '<button class="zehntage-close-x" title="Close" aria-label="Close">✕</button>' +
      "</span></div>" +
      html;
  } else {
    popup.innerHTML = html;
  }

  document.body.appendChild(popup);

  if (mobile) {
    const gear = popup.querySelector(".zehntage-gear");
    if (gear) {
      gear.addEventListener("click", (e) => {
        e.stopPropagation();
        showSettings(lastRect);
      });
    }
    const closeX = popup.querySelector(".zehntage-close-x");
    if (closeX) {
      closeX.addEventListener("click", (e) => {
        e.stopPropagation();
        requestSeq++;
        removePopup();
      });
    }
    return popup; // sheet is anchored by CSS — no inline positioning needed
  }

  const top = rect.bottom + window.scrollY + 6;
  const left = Math.max(8, rect.left + window.scrollX);
  popup.style.top = top + "px";
  popup.style.left = left + "px";

  requestAnimationFrame(() => {
    if (!popup) return;
    const popupRect = popup.getBoundingClientRect();
    if (popupRect.right > window.innerWidth - 8) {
      popup.style.left =
        Math.max(8, window.innerWidth - popupRect.width - 8) + "px";
    }
  });

  return popup;
}

const SPEAKER_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">' +
  '<path d="M4 9v6h4l5 5V4L8 9H4z"/>' +
  '<path d="M16.5 12a4.5 4.5 0 0 0-2-3.74v7.48a4.5 4.5 0 0 0 2-3.74z"/>' +
  "</svg>";

function showLoading(rect) {
  createPopup(rect, '<span class="zehntage-loading">Translating...</span>');
}

function showTranslation(rect, word, translation, notes, context, article, isSingleWord, pageContext, elapsed, lang) {
  const wordLower = word.toLowerCase();
  const alreadySaved = knownWords.hasOwnProperty(wordLower);
  const display = article ? `${article} ${word}` : word;
  // Elide the source side only; keep the translation full.
  const displayElided = elideMiddle(display);
  // Old cached/known words predate the lang field — a German article is still
  // a reliable enough hint to pronounce them correctly.
  const speakLang = lang || (article ? "de-DE" : "");

  let html = `<span class="word">${escapeHtml(displayElided).replace(/\n/g, "<br>")}</span> → ${escapeHtml(translation).replace(/\n/g, "<br>")}`;
  if (isSingleWord) {
    html += ` <button class="btn-speak" data-text="${escapeAttr(display)}" data-lang="${escapeAttr(speakLang)}" title="Pronounce" aria-label="Pronounce">${SPEAKER_ICON}</button>`;
  }

  if (notes) {
    html += `<div class="notes">${escapeHtml(notes)}</div>`;
  }
  if (elapsed) {
    html += `<div class="zehntage-elapsed">${escapeHtml(elapsed)}</div>`;
  }

  let actions = "";
  if (isSingleWord) {
    if (alreadySaved) {
      html += `<div class="saved-label">Already saved</div>`;
      actions += `<button class="btn-delete" data-word="${escapeAttr(word)}">Delete</button>`;
    } else {
      actions += `<button class="btn-anki" data-word="${escapeAttr(word)}" data-translation="${escapeAttr(translation)}" data-notes="${escapeAttr(notes || "")}" data-context="${escapeAttr(context || "")}" data-article="${escapeAttr(article || "")}">Add to Anki</button>`;
    }
  }

  const refContext = pageContext || context || "";
  actions += `<button class="btn-discuss" data-text="${escapeAttr(word)}" data-context="${escapeAttr(refContext)}">Discuss</button>`;
  html += `<div class="actions">${actions}</div>`;

  const el = createPopup(rect, html);

  const speakBtn = el.querySelector(".btn-speak");
  if (speakBtn) {
    speakBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      speak(speakBtn.dataset.text, speakBtn.dataset.lang);
    });
  }

  const btn = el.querySelector(".btn-anki");
  if (btn) {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      handleAddWord(btn);
    });
  }

  const delBtn = el.querySelector(".btn-delete");
  if (delBtn) {
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      handleDeleteWord(delBtn);
    });
  }

  const discussBtn = el.querySelector(".btn-discuss");
  if (discussBtn) {
    discussBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      handleDiscuss(discussBtn);
    });
  }
}

function showError(rect, message) {
  createPopup(rect, `<span class="error">${escapeHtml(message)}</span>`);
}

// Pronounce a word via Google Translate's TTS endpoint. No API key — and
// unlike the Web Speech API, it doesn't depend on the OS having any voices
// installed (many Linux desktops have none, which makes speechSynthesis fail
// silently with a "not-allowed" error and zero voices in getVoices()).
// The fetch happens in the background script: translate_tts requires a
// Referer header content scripts can't set, and returns a non-audio body
// without one.
let speakAudio = null;
async function speak(text, lang) {
  if (!text) return;
  if (speakAudio) speakAudio.pause(); // interrupt anything already playing
  try {
    const resp = await chrome.runtime.sendMessage({ action: "speak", text, lang });
    if (resp && resp.ok) {
      speakAudio = new Audio(resp.dataUrl);
      speakAudio.play().catch(() => {});
    }
  } catch {}
}

// In-page settings (Gemini key, Anki, site filters). Reachable on mobile where
// the toolbar popup is awkward — via the sheet's gear, or auto-shown when no key
// is set yet. Writes the same storage keys the toolbar popup uses.
async function showSettings(rect, message) {
  const {
    apiKey = "",
    groqApiKey = "",
    claudeApiKey = "",
    cerebrasApiKey = "",
    provider = "gemini",
    groqModel = "",
    ankiUrl = "",
    ankiKey = "",
    sitePatterns = [],
  } = await chrome.storage.local.get([
    "apiKey",
    "groqApiKey",
    "claudeApiKey",
    "cerebrasApiKey",
    "provider",
    "groqModel",
    "ankiUrl",
    "ankiKey",
    "sitePatterns",
  ]);

  const selected = (v) =>
    (provider === "groq" ? (groqModel === "qwen/qwen3.6-27b" ? "groq-qwen" : groqModel === "openai/gpt-oss-20b" ? "groq-20b" : "groq-120b") : provider) === v
      ? " selected"
      : "";

  const html =
    (message
      ? `<div class="zehntage-settings-msg">${escapeHtml(message)}</div>`
      : "") +
    `<label class="zehntage-field">Model
      <select class="zehntage-input" data-k="provider">
        <option value="gemini"${selected("gemini")}>Gemini 3.1 Flash Lite</option>
        <option value="groq-120b"${selected("groq-120b")}>GPT OSS 120B (Groq)</option>
        <option value="groq-20b"${selected("groq-20b")}>GPT OSS 20B (Groq)</option>
        <option value="groq-qwen"${selected("groq-qwen")}>Qwen3.6 27B (Groq)</option>
        <option value="claude"${selected("claude")}>Claude Sonnet 5</option>
        <option value="cerebras"${selected("cerebras")}>GLM 4.7 (Cerebras)</option>
      </select></label>
    <label class="zehntage-field">Gemini API Key
      <input type="password" class="zehntage-input" data-k="apiKey" value="${escapeAttr(apiKey)}" placeholder="paste key here"></label>
    <label class="zehntage-field">Groq API Key
      <input type="password" class="zehntage-input" data-k="groqApiKey" value="${escapeAttr(groqApiKey)}" placeholder="paste key here"></label>
    <label class="zehntage-field">Anthropic API Key
      <input type="password" class="zehntage-input" data-k="claudeApiKey" value="${escapeAttr(claudeApiKey)}" placeholder="paste key here"></label>
    <label class="zehntage-field">Cerebras API Key
      <input type="password" class="zehntage-input" data-k="cerebrasApiKey" value="${escapeAttr(cerebrasApiKey)}" placeholder="paste key here"></label>
    <label class="zehntage-field">Anki MCP URL
      <input type="text" class="zehntage-input" data-k="ankiUrl" value="${escapeAttr(ankiUrl)}" placeholder="https://..."></label>
    <label class="zehntage-field">Anki Key
      <input type="password" class="zehntage-input" data-k="ankiKey" value="${escapeAttr(ankiKey)}" placeholder="paste key here"></label>
    <label class="zehntage-field">Active sites (one regex per line)
      <textarea class="zehntage-input zehntage-textarea" data-k="sitePatterns" rows="3" placeholder=".*">${escapeHtml(sitePatterns.join("\n"))}</textarea></label>
    <div class="actions">
      <button class="btn-anki zehntage-save">Save</button>
      <button class="btn-discuss zehntage-close">Close</button>
    </div>
    <div class="zehntage-settings-status"></div>`;

  const el = createPopup(rect, html);
  const statusEl = el.querySelector(".zehntage-settings-status");
  const val = (k) => {
    const f = el.querySelector(`[data-k="${k}"]`);
    return f ? f.value : "";
  };

  el.querySelector(".zehntage-save").addEventListener("click", async (e) => {
    e.stopPropagation();
    const choiceV = val("provider") || "gemini";
    const providerV = choiceV.startsWith("groq") ? "groq" : choiceV;
    const groqModelV =
      choiceV === "groq-20b"
        ? "openai/gpt-oss-20b"
        : choiceV === "groq-qwen"
          ? "qwen/qwen3.6-27b"
          : "openai/gpt-oss-120b";
    const apiKeyV = val("apiKey").trim();
    const groqApiKeyV = val("groqApiKey").trim();
    const claudeApiKeyV = val("claudeApiKey").trim();
    const cerebrasApiKeyV = val("cerebrasApiKey").trim();
    const keys = {
      apiKey: apiKeyV,
      groqApiKey: groqApiKeyV,
      claudeApiKey: claudeApiKeyV,
      cerebrasApiKey: cerebrasApiKeyV,
    };
    if (!hasKeyForProvider(providerV, keys)) {
      statusEl.textContent = "Enter the API key for this model first.";
      return;
    }
    const ankiUrlV = val("ankiUrl")
      .trim()
      .replace(/\/+$/, "")
      .replace(/\/mcp$/, "")
      .replace(/\/+$/, "");
    const patterns = val("sitePatterns")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    await chrome.storage.local.set({
      ...keys,
      provider: providerV,
      groqModel: groqModelV,
      ankiUrl: ankiUrlV,
      ankiKey: val("ankiKey").trim(),
      sitePatterns: patterns,
    });
    apiKeyPresent = hasKeyForProvider(providerV, keys);
    await checkSiteEnabled();
    statusEl.textContent = "Saved!";

    // If a selection is still live, translate it right away; else just close.
    setTimeout(() => {
      const t = window.getSelection().toString().trim();
      if (t && enabled) lookupSelection();
      else removePopup();
    }, 600);
  });

  el.querySelector(".zehntage-close").addEventListener("click", (e) => {
    e.stopPropagation();
    requestSeq++;
    removePopup();
  });
}

async function handleAddWord(btn) {
  const word = btn.dataset.word;
  const translation = btn.dataset.translation;
  const notes = btn.dataset.notes;
  const context = btn.dataset.context;
  const article = btn.dataset.article || "";

  btn.disabled = true;
  btn.textContent = "Saving...";

  try {
    const resp = await chrome.runtime.sendMessage({
      action: "addWord",
      word,
      translation,
      notes,
      context,
      article,
    });

    if (resp.ok) {
      btn.textContent = "Saved to Anki";
      btn.classList.add("saved");
      knownWords[word.toLowerCase()] = {
        back: translation,
        notes,
        context,
        article,
        front_full: article ? `${article} ${word}` : word,
      };
      safeHighlight();
    } else {
      btn.textContent = "Error";
    }
  } catch {
    btn.textContent = "Error";
  }
}

async function handleDeleteWord(btn) {
  const word = btn.dataset.word;

  btn.disabled = true;
  btn.textContent = "Deleting...";

  try {
    const resp = await chrome.runtime.sendMessage({
      action: "deleteWord",
      word,
    });

    if (resp.ok) {
      delete knownWords[word.toLowerCase()];
      safeHighlight();
      removePopup();
    } else {
      btn.disabled = false;
      btn.textContent = "Error";
    }
  } catch {
    btn.disabled = false;
    btn.textContent = "Error";
  }
}

function handleDiscuss(btn) {
  const text = btn.dataset.text;
  const context = (btn.dataset.context || "").substring(0, 1000);

  const prompt = `While reading ${window.location.href} I came across this passage:

${context}

The part I selected: «${text}».
`;

  const url = "https://claude.ai/new?incognito&q=" + encodeURIComponent(prompt);
  window.open(url, "_blank");
}

// --- Selection handling ---

// Set when a mousedown dismissed an open popup during the current gesture.
// The matching mouseup uses it (via isPureDismissal) to avoid re-opening from
// a stale selection — but only when the selection did not actually change.
let dismissedByMousedown = false;
// The selection text as it stood at the start of the current mouse gesture,
// so the matching mouseup can tell a pure dismissal (selection unchanged)
// from the start of a brand-new selection (selection changed).
let selectionAtMousedown = "";
// Monotonic id for the in-flight translate lookup. Bumped when a new lookup
// starts or the popup is dismissed, so a slow/out-of-order response can tell
// it was superseded and must not draw a stale (or already-dismissed) popup.
let requestSeq = 0;

// A mousedown dismissed an open popup. Decide whether the matching mouseup is
// a PURE DISMISSAL (just closed the popup — suppress) versus the start of a
// NEW selection made in the same gesture (press-drag, or multi-click-then-drag
// — must be honored). Suppress only when the selection did not change.
function isPureDismissal(dismissedThisGesture, textAtMousedown, currentText) {
  if (!dismissedThisGesture) return false;
  if (!currentText) return true;          // nothing selected → only a dismissal
  return currentText === textAtMousedown; // unchanged → stale leftover, not new
}

// A response is current only if no newer lookup started and the popup was
// not dismissed while we awaited it.
function shouldRender(myGen, currentSeq) {
  return myGen === currentSeq;
}

// Run a lookup for the current selection and render the result. Shared by the
// desktop (mouseup) and mobile (selectionchange) triggers.
async function lookupSelection() {
  // Measured from the moment a selection is acted on to the moment the full
  // answer is rendered — shown next to the result so slow responses are visible.
  const startTime = performance.now();
  const elapsedNow = () => ((performance.now() - startTime) / 1000).toFixed(1) + "s";

  const sel = window.getSelection();
  const text = sel.toString().trim();

  // No real, non-collapsed selection → nothing to translate.
  if (!text || sel.rangeCount === 0 || sel.getRangeAt(0).collapsed) {
    removePopup();
    return;
  }

  // A new selection supersedes any earlier in-flight lookup: tag this one so
  // a slow/out-of-order response from a previous selection can't overwrite it.
  const myGen = ++requestSeq;

  const range = sel.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  const isSingleWord = /^\S+$/.test(text);

  // Get surrounding context
  const container = findBlockAncestor(range.commonAncestorContainer);
  const context = (container.textContent || "").substring(0, 500);

  // No key yet → show the settings sheet instead of a guaranteed failure.
  if (!apiKeyPresent) {
    showSettings(rect, "Set your Gemini API key to start.");
    return;
  }

  // Check if single word is already known — use local cache, no async
  if (isSingleWord) {
    const key = text.toLowerCase();
    if (knownWords[key]) {
      showTranslation(
        rect,
        text,
        knownWords[key].back,
        knownWords[key].notes,
        knownWords[key].context,
        knownWords[key].article || "",
        true,
        context,
        elapsedNow()
      );
      return;
    }
  }

  const cacheKey = (isSingleWord ? "w:" : "p:") + text;
  if (lookupCache[cacheKey]) {
    const c = lookupCache[cacheKey];
    showTranslation(
      rect,
      text,
      c.translation,
      c.notes,
      c.context,
      c.article || "",
      isSingleWord,
      context,
      elapsedNow(),
      c.lang || ""
    );
    return;
  }

  showLoading(rect);
  // Grab the loading span so streamed chunks can update it in place, without
  // tearing down and rebuilding the whole popup on every delta.
  const loadingEl = popup ? popup.querySelector(".zehntage-loading") : null;

  try {
    const result = await new Promise((resolve) => {
      const port = chrome.runtime.connect({ name: "translate" });
      port.onMessage.addListener((msg) => {
        if (msg.type === "chunk") {
          if (loadingEl && shouldRender(myGen, requestSeq)) {
            loadingEl.textContent = msg.text;
          }
        } else if (msg.type === "done") {
          port.disconnect();
          resolve({ ok: true, ...msg.result });
        } else if (msg.type === "error") {
          port.disconnect();
          resolve({ ok: false, error: msg.error });
        }
      });
      port.postMessage({
        action: "translate",
        text,
        context,
        url: location.href.substring(0, 200),
        isSingleWord,
      });
    });

    // Superseded by a newer selection or dismissed while we waited → drop it.
    if (!shouldRender(myGen, requestSeq)) return;

    if (result.ok) {
      lookupCache[cacheKey] = {
        translation: result.translation,
        notes: result.notes,
        context: result.context,
        article: result.article || "",
        lang: result.lang || "",
      };
      showTranslation(
        rect,
        text,
        result.translation,
        result.notes,
        result.context,
        result.article || "",
        isSingleWord,
        context,
        elapsedNow(),
        result.lang || ""
      );
    } else {
      showError(rect, result.error || "Translation failed");
    }
  } catch (err) {
    if (!shouldRender(myGen, requestSeq)) return;
    showError(rect, err.message);
  }
}

// Desktop: a finished mouse gesture drives selection lookups.
document.addEventListener("mouseup", async (e) => {
  if (isMobile()) return;
  if (!enabled) return;
  if (popup && popup.contains(e.target)) return;

  const sel = window.getSelection();
  const text = sel.toString().trim();

  // A mousedown in this gesture closed the popup. Suppress re-opening ONLY
  // when this was a pure dismissal — not when the same gesture (press-drag,
  // or multi-click-then-drag) produced a new selection to translate.
  const dismissed = dismissedByMousedown;
  dismissedByMousedown = false;
  if (isPureDismissal(dismissed, selectionAtMousedown, text)) return;

  await lookupSelection();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    requestSeq++;
    removePopup();
  }
});

document.addEventListener("mousedown", (e) => {
  if (isMobile()) return;
  // Snapshot the selection at gesture start so the matching mouseup can tell
  // a dismissal (selection unchanged) from the start of a new selection.
  selectionAtMousedown = window.getSelection().toString().trim();
  if (popup && !popup.contains(e.target)) {
    requestSeq++; // invalidate any in-flight lookup so it can't re-open the popup
    removePopup();
    dismissedByMousedown = true;
  }
});

// Mobile: selection is made with long-press + drag handles, which don't give a
// reliable mouseup. Watch selectionchange instead, debounced until the
// selection settles, then run the same lookup.
let selChangeTimer = null;
document.addEventListener("selectionchange", () => {
  if (!isMobile() || !enabled) return;
  const text = window.getSelection().toString().trim();
  if (!text) return; // collapsing the selection shouldn't tear down an open sheet
  clearTimeout(selChangeTimer);
  selChangeTimer = setTimeout(() => {
    // Don't clobber a settings sheet the user is currently filling in.
    if (popup && popup.querySelector(".zehntage-save")) return;
    if (window.getSelection().toString().trim()) lookupSelection();
  }, 400);
});

// --- Word highlighting ---

let observerActive = false;

function startObserver() {
  if (observerActive) return;
  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
  });
  observerActive = true;
}

function stopObserver() {
  observer.disconnect();
  observerActive = false;
}

function safeHighlight() {
  stopObserver();
  highlightKnownWords();
  startObserver();
}

function highlightKnownWords() {
  // Remove existing highlights
  document.querySelectorAll("mark.zehntage-word").forEach((mark) => {
    const parent = mark.parentNode;
    parent.replaceChild(document.createTextNode(mark.textContent), mark);
    parent.normalize();
  });

  const wordList = Object.keys(knownWords);
  if (wordList.length === 0) return;

  const escaped = wordList.map((w) =>
    w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  );
  const pattern = new RegExp(`\\b(${escaped.join("|")})\\b`, "gi");

  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (node.parentElement.closest(".zehntage-popup")) {
          return NodeFilter.FILTER_REJECT;
        }
        const tag = node.parentElement.tagName;
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") {
          return NodeFilter.FILTER_REJECT;
        }
        if (node.parentElement.classList.contains("zehntage-word")) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    }
  );

  const textNodes = [];
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode);
  }

  for (const node of textNodes) {
    const text = node.textContent;
    if (!pattern.test(text)) continue;
    pattern.lastIndex = 0;

    const frag = document.createDocumentFragment();
    let lastIndex = 0;
    let match;

    while ((match = pattern.exec(text)) !== null) {
      if (match.index > lastIndex) {
        frag.appendChild(
          document.createTextNode(text.substring(lastIndex, match.index))
        );
      }
      const mark = document.createElement("mark");
      mark.className = "zehntage-word";
      mark.textContent = match[0];
      frag.appendChild(mark);
      lastIndex = pattern.lastIndex;
    }

    if (lastIndex < text.length) {
      frag.appendChild(document.createTextNode(text.substring(lastIndex)));
    }

    node.parentNode.replaceChild(frag, node);
  }
}

// Load words and highlight on page load
async function init() {
  await checkSiteEnabled();
  if (!enabled) return;

  const keys = await chrome.storage.local.get([
    "apiKey",
    "groqApiKey",
    "claudeApiKey",
    "cerebrasApiKey",
    "provider",
  ]);
  apiKeyPresent = hasKeyForProvider(keys.provider || "gemini", keys);

  try {
    const resp = await chrome.runtime.sendMessage({ action: "getWords" });
    if (resp.ok && resp.words) {
      knownWords = resp.words;
      safeHighlight();
    }
  } catch {}
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

// Keep this tab in sync when settings change elsewhere (toolbar popup, options
// page, or another tab): refresh the key gate and re-highlight on word changes.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (
    changes.apiKey ||
    changes.groqApiKey ||
    changes.claudeApiKey ||
    changes.cerebrasApiKey ||
    changes.provider
  ) {
    chrome.storage.local
      .get(["apiKey", "groqApiKey", "claudeApiKey", "cerebrasApiKey", "provider"])
      .then((keys) => {
        apiKeyPresent = hasKeyForProvider(keys.provider || "gemini", keys);
      });
  }
  if (changes.words) {
    knownWords = changes.words.newValue || {};
    if (enabled) safeHighlight();
  }
});

// Re-highlight on dynamic content changes (SPAs), debounced
let highlightTimer = null;
const observer = new MutationObserver(() => {
  if (!enabled || Object.keys(knownWords).length === 0) return;
  // Don't re-highlight while user has an active selection
  const sel = window.getSelection();
  if (sel && sel.toString().trim()) return;

  clearTimeout(highlightTimer);
  highlightTimer = setTimeout(() => safeHighlight(), 500);
});
startObserver();

// --- Helpers ---

function findBlockAncestor(node) {
  const el = node.nodeType === 3 ? node.parentElement : node;
  return (
    el.closest("p, div, li, td, th, article, section, blockquote") ||
    document.body
  );
}

function elideMiddle(s, keep = 3) {
  const words = s.trim().split(/\s+/);
  if (words.length <= keep * 2) return s;
  return words.slice(0, keep).join(" ") + " … " + words.slice(-keep).join(" ");
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function escapeAttr(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
