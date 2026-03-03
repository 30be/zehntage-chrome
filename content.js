let popup = null;
let knownWords = {};
let enabled = false;

// --- Site filtering ---

async function checkSiteEnabled() {
  const { sitePatterns } = await chrome.storage.local.get("sitePatterns");
  // No patterns configured = enabled everywhere
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
  popup = document.createElement("div");
  popup.className = "zehntage-popup";
  popup.innerHTML = html;

  document.body.appendChild(popup);

  // Position below selection, accounting for scroll
  const top = rect.bottom + window.scrollY + 6;
  const left = Math.max(8, rect.left + window.scrollX);
  popup.style.top = top + "px";
  popup.style.left = left + "px";

  // Clamp to viewport right edge
  requestAnimationFrame(() => {
    const popupRect = popup.getBoundingClientRect();
    if (popupRect.right > window.innerWidth - 8) {
      popup.style.left =
        Math.max(8, window.innerWidth - popupRect.width - 8) + "px";
    }
  });

  return popup;
}

function showLoading(rect) {
  createPopup(rect, '<span class="zehntage-loading">Translating...</span>');
}

function showTranslation(rect, word, translation, notes, isSingleWord) {
  const wordLower = word.toLowerCase();
  const alreadySaved = knownWords.hasOwnProperty(wordLower);

  let html = `<span class="word">${escapeHtml(word)}</span> → ${escapeHtml(translation)}`;

  if (isSingleWord && notes) {
    html += `<div class="notes">${escapeHtml(notes)}</div>`;
  }

  if (isSingleWord) {
    if (alreadySaved) {
      html += `<div class="saved-label">Already saved</div>`;
    } else {
      html += `<button class="btn-anki" data-word="${escapeAttr(word)}" data-translation="${escapeAttr(translation)}" data-notes="${escapeAttr(notes || "")}">Add to Anki</button>`;
    }
  }

  const el = createPopup(rect, html);

  const btn = el.querySelector(".btn-anki");
  if (btn) {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      handleAddWord(btn);
    });
  }
}

function showError(rect, message) {
  createPopup(rect, `<span class="error">${escapeHtml(message)}</span>`);
}

async function handleAddWord(btn) {
  const word = btn.dataset.word;
  const translation = btn.dataset.translation;
  const notes = btn.dataset.notes;

  // Grab context from surrounding text
  const sel = window.getSelection();
  let context = "";
  if (sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    const container = findBlockAncestor(range.commonAncestorContainer);
    context = (container.textContent || "").substring(0, 500);
  }

  btn.disabled = true;
  btn.textContent = "Saving...";

  try {
    const resp = await chrome.runtime.sendMessage({
      action: "addWord",
      word,
      translation,
      notes,
      context,
    });

    if (resp.ok) {
      btn.textContent = resp.ankiOk ? "Saved to Anki" : "Saved to file";
      btn.classList.add("saved");
      knownWords[word.toLowerCase()] = { back: translation, notes, context };
      highlightKnownWords();
    } else {
      btn.textContent = "Error";
    }
  } catch {
    btn.textContent = "Error";
  }
}

// --- Selection handling ---

document.addEventListener("mouseup", async (e) => {
  if (!enabled) return;
  // Ignore clicks inside our own popup
  if (popup && popup.contains(e.target)) return;

  const sel = window.getSelection();
  const text = sel.toString().trim();

  if (!text) {
    removePopup();
    return;
  }

  const range = sel.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  const isSingleWord = /^\S+$/.test(text);

  // Check if single word is already known
  if (isSingleWord) {
    const lookup = await chrome.runtime.sendMessage({
      action: "lookupWord",
      word: text,
    });
    if (lookup.ok && lookup.found) {
      showTranslation(rect, text, lookup.back, lookup.notes, true);
      return;
    }
  }

  // Get surrounding context
  const container = findBlockAncestor(range.commonAncestorContainer);
  const context = (container.textContent || "").substring(0, 500);

  showLoading(rect);

  try {
    const result = await chrome.runtime.sendMessage({
      action: "translate",
      text,
      context,
      isSingleWord,
    });

    if (result.ok) {
      showTranslation(
        rect,
        text,
        result.translation,
        result.notes,
        isSingleWord
      );
    } else {
      showError(rect, result.error || "Translation failed");
    }
  } catch (err) {
    showError(rect, err.message);
  }
});

// Dismiss popup on Escape
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") removePopup();
});

// Dismiss popup on outside click
document.addEventListener("mousedown", (e) => {
  if (popup && !popup.contains(e.target)) {
    removePopup();
  }
});

// --- Word highlighting ---

function highlightKnownWords() {
  // Remove existing highlights
  document.querySelectorAll("mark.zehntage-word").forEach((mark) => {
    const parent = mark.parentNode;
    parent.replaceChild(document.createTextNode(mark.textContent), mark);
    parent.normalize();
  });

  const wordList = Object.keys(knownWords);
  if (wordList.length === 0) return;

  // Build regex from all known words
  const escaped = wordList.map((w) =>
    w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  );
  const pattern = new RegExp(`\\b(${escaped.join("|")})\\b`, "gi");

  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        // Skip our own popup, script/style tags, and already-highlighted nodes
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
      // Add text before match
      if (match.index > lastIndex) {
        frag.appendChild(
          document.createTextNode(text.substring(lastIndex, match.index))
        );
      }
      // Add highlighted match
      const mark = document.createElement("mark");
      mark.className = "zehntage-word";
      mark.textContent = match[0];
      frag.appendChild(mark);
      lastIndex = pattern.lastIndex;
    }

    // Add remaining text
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

  try {
    const resp = await chrome.runtime.sendMessage({ action: "getWords" });
    if (resp.ok && resp.words) {
      knownWords = resp.words;
      highlightKnownWords();
    }
  } catch {}
}

// Run init when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

// Re-highlight on dynamic content changes (SPAs)
const observer = new MutationObserver(() => {
  if (Object.keys(knownWords).length > 0) {
    highlightKnownWords();
  }
});
observer.observe(document.body || document.documentElement, {
  childList: true,
  subtree: true,
});

// --- Helpers ---

function findBlockAncestor(node) {
  const el = node.nodeType === 3 ? node.parentElement : node;
  return (
    el.closest("p, div, li, td, th, article, section, blockquote") ||
    document.body
  );
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
