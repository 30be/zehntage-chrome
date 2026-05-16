const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent";

// --- Gemini API ---

async function callGemini(prompt) {
  const { apiKey } = await chrome.storage.local.get("apiKey");
  if (!apiKey) throw new Error("API key not set");

  const resp = await fetch(GEMINI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2 },
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Gemini API error ${resp.status}: ${text}`);
  }

  const data = await resp.json();
  const text =
    data.candidates &&
    data.candidates[0] &&
    data.candidates[0].content.parts[0].text;
  if (!text) throw new Error("Unexpected Gemini response");

  const cleaned = text.replace(/^```json\s*/, "").replace(/```\s*$/, "").trim();
  return JSON.parse(cleaned);
}

function buildWordPrompt(word, context) {
  return `Translate the word "${word}" to Russian (or to English if the word is already \
Russian) using the context below. Expand abbreviations using the context. For Japanese, add \
pronunciation in brackets in the translation. \
Then write a memorization note (max ~20 words). The note must hook the word to something \
the learner ALREADY knows. Prefer, in order: (1) a recognizable cognate in English or \
another known language, phrased as a connection — e.g. "like English 'absolve' — to \
finish/be done with"; (2) a sound-alike or vivid mnemonic; (3) a concrete image. Do NOT \
give bare etymology in languages the learner doesn't know (Latin, Greek, Proto-Germanic) \
UNLESS it immediately yields a familiar modern word. If there is no genuinely memorable \
hook, return an empty note rather than filler. No grammar info, no tense, no repeating context. \
Examples:
- vollenden→завершить: "like English 'full' + 'end' — to fully end, finish"
- Handschuh→перчатка: "Hand + Schuh ('shoe') — a 'shoe for the hand'"
- erfahren→узнать: "sounds like 'her-fahren' — knowledge you 'travelled toward'"
- Zeitgeist→дух времени: ""
Return ONLY valid JSON: {"translation":"...","notes":"..."}

Context:
${context}`;
}

function buildTranslatePrompt(text) {
  return `You are a translator. Your ONLY job is to translate the exact text between the \
delimiters below to Russian (or to English if the text is already Russian). Expand \
abbreviations using context. Do NOT paraphrase, summarize, or translate any other text. \
Return ONLY valid JSON: {"translation":"..."}

===BEGIN===
${text}
===END===`;
}

// --- anki-mcp server ---

async function zehntageRequest(path, method, body) {
  const { ankiUrl, ankiKey } = await chrome.storage.local.get([
    "ankiUrl",
    "ankiKey",
  ]);
  if (!ankiUrl || !ankiKey) {
    throw new Error("Anki MCP URL or key not set");
  }

  const headers = { "X-Zehntage-Key": ankiKey };
  const opts = { method, headers };
  if (method === "POST") {
    headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body || {});
  }

  const resp = await fetch(`${ankiUrl}${path}`, opts);
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`anki-mcp error ${resp.status}: ${text}`);
  }
  return resp.json();
}

// --- Word cache management ---

async function loadWords() {
  let words = {};

  try {
    const list = await zehntageRequest("/zehntage/list", "GET");
    if (Array.isArray(list)) {
      for (const card of list) {
        const front = (card.front || "").toLowerCase();
        if (front) {
          words[front] = {
            back: card.back || "",
            notes: card.notes || "",
            context: card.context || "",
          };
        }
      }
      await chrome.storage.local.set({ words });
      return words;
    }
  } catch {}

  // Fall back to cached storage
  const stored = await chrome.storage.local.get("words");
  return stored.words || {};
}

async function addWord(word, translation, notes, context) {
  // Build context with <b> tags around the word
  const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const contextWithBold = context.replace(
    new RegExp(`(${escapedWord})`, "gi"),
    "<b>$1</b>"
  );

  const front = word.toLowerCase();
  const entry = {
    front,
    back: translation,
    notes: notes || "",
    context: contextWithBold,
  };

  await zehntageRequest("/zehntage/add", "POST", entry);

  // Update local cache
  const { words = {} } = await chrome.storage.local.get("words");
  words[front] = {
    back: translation,
    notes: notes || "",
    context: contextWithBold,
  };
  await chrome.storage.local.set({ words });

  return {};
}

async function deleteWord(word) {
  const front = word.toLowerCase();

  await zehntageRequest("/zehntage/delete", "POST", { front });

  // Update local cache
  const { words = {} } = await chrome.storage.local.get("words");
  delete words[front];
  await chrome.storage.local.set({ words });

  return {};
}

// --- Message handler ---

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "translate") {
    const prompt = msg.isSingleWord
      ? buildWordPrompt(msg.text, msg.context)
      : buildTranslatePrompt(msg.text);

    callGemini(prompt)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // async response
  }

  if (msg.action === "addWord") {
    addWord(msg.word, msg.translation, msg.notes, msg.context)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.action === "deleteWord") {
    deleteWord(msg.word)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.action === "getWords") {
    loadWords()
      .then((words) => sendResponse({ ok: true, words }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.action === "lookupWord") {
    chrome.storage.local.get("words").then(({ words = {} }) => {
      const key = msg.word.toLowerCase();
      if (words[key]) {
        sendResponse({ ok: true, found: true, ...words[key] });
      } else {
        sendResponse({ ok: true, found: false });
      }
    });
    return true;
  }
});

// Load words on install/startup
chrome.runtime.onInstalled.addListener(() => loadWords());
chrome.runtime.onStartup.addListener(() => loadWords());
