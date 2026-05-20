const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent";

// --- Gemini API ---

const WORD_SCHEMA = {
  type: "OBJECT",
  properties: {
    translation: { type: "STRING" },
    notes: { type: "STRING" },
    context: { type: "STRING" },
  },
  required: ["translation", "notes", "context"],
};

const TRANSLATE_SCHEMA = {
  type: "OBJECT",
  properties: {
    translation: { type: "STRING" },
  },
  required: ["translation"],
};

async function callGemini(prompt, schema) {
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
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: schema,
      },
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
  return `The learner is a native Russian speaker, fluent in English, learning German. They are studying the word "${word}", which appeared in the text below.

Provide three fields:
- translation: "${word}" translated into Russian — or into English if the word is itself Russian. Expand abbreviations using the text. For Japanese words, append the pronunciation in brackets.
- notes: a short explanation, max ~25 words, that makes the word stick. When the translation alone loses nuance, say what the word actually means; always add a memory hook — a compound breakdown, a genuine cognate the learner already knows, a sound-alike, or a vivid image. Never leave this empty.
- context: the single sentence from the text below that best shows the word in use, trimmed to just that sentence, with the studied word wrapped in <b></b>. If the text below has no usable sentence, invent a short natural one.

Examples (word → translation: notes):
- vollenden → завершить: voll ('full') + enden ('to end') — to bring something fully to its end.
- Feierabend → конец рабочего дня: Feier ('celebration') + Abend ('evening') — not just quitting time, but the relaxed free evening after work.
- Wetter → погода: the English cognate 'weather' — literally the same word.

Text:
${context}`;
}

function buildTranslatePrompt(text) {
  return `Translate the text between the === markers into Russian — or into English if it is already Russian. Expand abbreviations using the surrounding words. Translate only that text, nothing else.

===
${text}
===`;
}

function buildSummaryPrompt(text) {
  return `Summarize the text between the === markers in Russian — or in English if the text is itself in Russian. Keep the summary concise (a few sentences, max ~60 words). Summarize only that text, nothing else.

===
${text}
===`;
}

function countWords(text) {
  return (text.trim().match(/\S+/g) || []).length;
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
  // context comes from the model already containing <b>...</b> — store as-is.
  const front = word.toLowerCase();
  const entry = {
    front,
    back: translation,
    notes: notes || "",
    context: context || "",
  };

  await zehntageRequest("/zehntage/add", "POST", entry);

  // Update local cache
  const { words = {} } = await chrome.storage.local.get("words");
  words[front] = {
    back: translation,
    notes: notes || "",
    context: context || "",
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
    let prompt;
    if (msg.isSingleWord) {
      prompt = buildWordPrompt(msg.text, msg.context);
    } else if (countWords(msg.text) > 100) {
      prompt = buildSummaryPrompt(msg.text);
    } else {
      prompt = buildTranslatePrompt(msg.text);
    }
    const schema = msg.isSingleWord ? WORD_SCHEMA : TRANSLATE_SCHEMA;

    callGemini(prompt, schema)
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
