const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent";

// --- Gemini API ---

const WORD_SCHEMA = {
  type: "OBJECT",
  properties: {
    article: { type: "STRING" },
    translation: { type: "STRING" },
    notes: { type: "STRING" },
    context: { type: "STRING" },
  },
  required: ["article", "translation", "notes", "context"],
};

const TRANSLATE_SCHEMA = {
  type: "OBJECT",
  properties: {
    translation: { type: "STRING" },
  },
  required: ["translation"],
};

const REF_SCHEMA = {
  type: "OBJECT",
  properties: { translation: { type: "STRING" }, notes: { type: "STRING" } },
  required: ["translation", "notes"],
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

Provide four fields:
- article: if "${word}" is a German common noun, return its definite article ("der", "die", or "das"). Otherwise (verbs, adjectives, English/Russian words, anything that is not a noun) return an empty string.
- translation: "${word}" translated into Russian — or into English if the word is itself Russian. Expand abbreviations using the text. For Japanese words, append the pronunciation in brackets.
- notes: If the studied word is a proper noun naming a real person, place, work, or brand, give a one-sentence encyclopedic abstract — who or what it is and what it is best known for (max ~30 words). Otherwise a short explanation (max ~25 words) that makes the word stick: when the translation loses nuance say what it actually means, and add a memory hook — a compound breakdown, a genuine cognate the learner already knows, a sound-alike, or a vivid image. Never leave this empty.
- context: the single sentence from the text below that best shows the word in use, trimmed to just that sentence, with the studied word wrapped in <b></b>. If the text below has no usable sentence, invent a short natural one.

Examples:
- "vollenden" → article: "", translation: "завершить", notes: "voll ('full') + enden ('to end') — to bring something fully to its end."
- "Handschuh" → article: "der", translation: "перчатка", notes: "Hand + Schuh ('shoe') — literally a 'shoe for the hand'."
- "Wetter" → article: "das", translation: "погода", notes: "the English cognate 'weather' — literally the same word."

Text:
${context}`;
}

function splitArticle(front) {
  const m = front.match(/^(der|die|das)\s+(.+)$/);
  return m ? { article: m[1], bare: m[2] } : { article: "", bare: front };
}

function buildTranslatePrompt(text) {
  return `Translate the text between the === markers into Russian — or into English if it is already Russian. Expand abbreviations using the surrounding words. Translate only that text, nothing else.

===
${text}
===`;
}

function buildRefPrompt(text, context) {
  return `The reader is a native Russian speaker, fluent in English. Translate and explain the text between the === markers, which they selected while reading the context below.

Provide two fields:
- translation: the selected text translated into Russian — or into English if it is itself Russian. Expand abbreviations using the context. Translate only the text between the markers.
- notes: a short note (max ~50 words, in the same language as the selected text) that helps the reader truly understand it. If it contains or alludes to a literary, biblical, historical, or cultural reference, a named work or person, a joke, an allusion, an idiom, or a double meaning — explain what it refers to and, if it is used ironically or rhetorically or as a joke, what the actual point is. If it quotes or names something famous, consider whether it is commonly misattributed or whether its modern usage differs from the original meaning, and say so. If the text is plain with no such reference, briefly clarify its meaning, nuance, or tone. Never leave notes empty.

Selected text:
===
${text}
===

Context:
${context}`;
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
        const front = card.front || "";
        if (front) {
          const { article, bare } = splitArticle(front);
          words[bare.toLowerCase()] = {
            back: card.back || "",
            notes: card.notes || "",
            context: card.context || "",
            article,
            front_full: front,
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

async function addWord(word, translation, notes, context, article) {
  // context comes from the model already containing <b>...</b> — store as-is.
  // Coerce any article that is not exactly der/die/das to "" before building.
  if (article !== "der" && article !== "die" && article !== "das") {
    article = "";
  }
  const key = word.toLowerCase();
  const front_full = article ? `${article} ${word}` : word;
  const entry = {
    front: front_full,
    back: translation,
    notes: notes || "",
    context: context || "",
  };

  await zehntageRequest("/zehntage/add", "POST", entry);

  // Update local cache
  const { words = {} } = await chrome.storage.local.get("words");
  words[key] = {
    back: translation,
    notes: notes || "",
    context: context || "",
    article: article || "",
    front_full,
  };
  await chrome.storage.local.set({ words });

  return {};
}

async function deleteWord(word) {
  const key = word.toLowerCase();

  // Look up the stored Front (which may include an article like "der Hund").
  const { words = {} } = await chrome.storage.local.get("words");
  const front_to_delete = (words[key] && words[key].front_full) || word;

  await zehntageRequest("/zehntage/delete", "POST", { front: front_to_delete });

  delete words[key];
  await chrome.storage.local.set({ words });

  return {};
}

// --- Message handler ---

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "translate") {
    let prompt, schema;
    if (msg.isSingleWord) {
      prompt = buildWordPrompt(msg.text, msg.context);
      schema = WORD_SCHEMA;
    } else if (countWords(msg.text) > 100) {
      prompt = buildSummaryPrompt(msg.text);
      schema = TRANSLATE_SCHEMA;
    } else {
      prompt = buildRefPrompt(msg.text, msg.context);
      schema = REF_SCHEMA;
    }

    callGemini(prompt, schema)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // async response
  }

  if (msg.action === "addWord") {
    addWord(msg.word, msg.translation, msg.notes, msg.context, msg.article)
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
