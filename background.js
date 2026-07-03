const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "openai/gpt-oss-120b";

const CLAUDE_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-sonnet-5";

// GLM 4.7, served over Cerebras' OpenAI-compatible endpoint.
const CEREBRAS_URL = "https://api.cerebras.ai/v1/chat/completions";
const CEREBRAS_MODEL = "zai-glm-4.7";

// --- Model providers ---

const WORD_SCHEMA = {
  type: "OBJECT",
  properties: {
    article: { type: "STRING" },
    translation: { type: "STRING" },
    notes: { type: "STRING" },
    context: { type: "STRING" },
    lang: { type: "STRING" },
  },
  required: ["article", "translation", "notes", "context", "lang"],
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

// Gemini schemas use uppercase types; Groq/OpenAI want lowercase JSON Schema.
function toJsonSchema(s) {
  if (!s || typeof s !== "object") return s;
  const out = {};
  if (s.type) out.type = String(s.type).toLowerCase();
  if (s.properties) {
    out.properties = {};
    for (const k of Object.keys(s.properties)) {
      out.properties[k] = toJsonSchema(s.properties[k]);
    }
    out.additionalProperties = false;
  }
  if (s.items) out.items = toJsonSchema(s.items);
  if (s.required) out.required = s.required;
  // strict mode requires every property listed in `required`
  if (out.properties && !out.required) out.required = Object.keys(out.properties);
  return out;
}

// Reads a text/event-stream response body, parsing each "data: {...}" line as
// JSON and handing it to onEvent. Malformed/keepalive lines are skipped.
async function readSSE(resp, onEvent) {
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop(); // last line may be incomplete — carry it over
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        onEvent(JSON.parse(data));
      } catch {}
    }
  }
}

function parseModelJson(full, label) {
  if (!full) throw new Error(`Unexpected ${label} response`);
  const cleaned = full
    .replace(/^```json\s*/, "")
    .replace(/```\s*$/, "")
    .trim();
  return JSON.parse(cleaned);
}

async function callGemini(prompt, schema, onChunk) {
  const { apiKey } = await chrome.storage.local.get("apiKey");
  if (!apiKey) throw new Error("API key not set");

  const resp = await fetch(`${GEMINI_URL.replace(":generateContent", ":streamGenerateContent")}?alt=sse`, {
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
        // Flash-Lite's dynamic thinking is the main source of the occasional
        // multi-second latency spikes on this kind of short task — turn it off.
        thinkingConfig: { thinkingBudget: 0 },
      },
      service_tier: "priority", // 2x the price
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Gemini API error ${resp.status}: ${text}`);
  }

  let full = "";
  await readSSE(resp, (evt) => {
    const part =
      evt.candidates &&
      evt.candidates[0] &&
      evt.candidates[0].content &&
      evt.candidates[0].content.parts &&
      evt.candidates[0].content.parts[0];
    if (part && part.text) {
      full += part.text;
      if (onChunk) onChunk(full);
    }
  });

  return parseModelJson(full, "Gemini");
}

async function callGroq(prompt, schema, onChunk) {
  const { groqApiKey, groqModel } = await chrome.storage.local.get(["groqApiKey", "groqModel"]);
  if (!groqApiKey) throw new Error("Groq API key not set");
  const model = groqModel || GROQ_MODEL;

  const resp = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${groqApiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      // gpt-oss: 120b gets a fuller reasoning pass ("high"), 20b stays fast
      // at "low". Qwen3.6 uses a different value set for the same param —
      // "default" (thinking mode) vs "none" — so it needs "none" explicitly
      // or it defaults to thinking mode, which is too slow for this use case.
      reasoning_effort: model.includes("gpt-oss")
        ? model.includes("120b")
          ? "high"
          : "low"
        : "none",
      stream: true,
      messages: [{ role: "user", content: prompt }],
      response_format: {
        type: "json_schema",
        json_schema: { name: "result", strict: true, schema: toJsonSchema(schema) },
      },
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Groq API error ${resp.status}: ${text}`);
  }

  let full = "";
  await readSSE(resp, (evt) => {
    const delta = evt.choices && evt.choices[0] && evt.choices[0].delta && evt.choices[0].delta.content;
    if (delta) {
      full += delta;
      if (onChunk) onChunk(full);
    }
  });

  return parseModelJson(full, "Groq");
}

async function callClaude(prompt, schema, onChunk) {
  const { claudeApiKey } = await chrome.storage.local.get("claudeApiKey");
  if (!claudeApiKey) throw new Error("Anthropic API key not set");

  const resp = await fetch(CLAUDE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": claudeApiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      stream: true,
      system: `Respond with only a JSON object matching this schema, no other text: ${JSON.stringify(toJsonSchema(schema))}`,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    let message = text;
    try {
      message = JSON.parse(text).error.message || text;
    } catch {}
    throw new Error(`Claude API error ${resp.status}: ${message}`);
  }

  let full = "";
  await readSSE(resp, (evt) => {
    if (evt.type === "content_block_delta" && evt.delta && evt.delta.type === "text_delta") {
      full += evt.delta.text;
      if (onChunk) onChunk(full);
    }
  });

  return parseModelJson(full, "Claude");
}

async function callCerebras(prompt, schema, onChunk) {
  const { cerebrasApiKey } = await chrome.storage.local.get("cerebrasApiKey");
  if (!cerebrasApiKey) throw new Error("Cerebras API key not set");

  const resp = await fetch(CEREBRAS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cerebrasApiKey}`,
    },
    body: JSON.stringify({
      model: CEREBRAS_MODEL,
      temperature: 0.2,
      // GLM 4.7 non-reasoning — no thinking pass for this quick-translation use case.
      reasoning_effort: "none",
      stream: true,
      messages: [{ role: "user", content: prompt }],
      response_format: {
        type: "json_schema",
        json_schema: { name: "result", strict: true, schema: toJsonSchema(schema) },
      },
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Cerebras API error ${resp.status}: ${text}`);
  }

  let full = "";
  await readSSE(resp, (evt) => {
    const delta = evt.choices && evt.choices[0] && evt.choices[0].delta && evt.choices[0].delta.content;
    if (delta) {
      full += delta;
      if (onChunk) onChunk(full);
    }
  });

  return parseModelJson(full, "Cerebras");
}

// Route to the provider chosen in settings (defaults to Gemini). onChunk, if
// given, is called with the accumulated raw text as it streams in.
async function callModel(prompt, schema, onChunk) {
  const { provider } = await chrome.storage.local.get("provider");
  if (provider === "groq") return callGroq(prompt, schema, onChunk);
  if (provider === "claude") return callClaude(prompt, schema, onChunk);
  if (provider === "cerebras") return callCerebras(prompt, schema, onChunk);
  return callGemini(prompt, schema, onChunk);
}

function buildWordPrompt(word, context, url) {
  return `The learner is native Russian, English C2, German B2. They are studying the word "${word}", which appeared in the text below.

Provide five fields:
- article: if "${word}" is a German common noun, and the context is in German, return its definite article ("der", "die", or "das"). Otherwise return an *empty string*.
- translation: "${word}" translated into Russian — or into English if the word is itself Russian. Expand abbreviations using the text. For Japanese words, append the pronunciation in brackets.
- notes: If the studied word is a proper noun naming a real person, place, work, or brand, give a one-sentence encyclopedic abstract — who or what it is and what it is best known for (max ~30 words). Otherwise a short explanation (max ~25 words) that makes the word stick: when the translation loses nuance say what it actually means, and add a memory hook — a compound breakdown, a genuine cognate the learner already knows, a sound-alike, or a vivid image. Never leave this empty.
- context: the single sentence from the text below that best shows the word in use, trimmed to just that sentence, with the studied word wrapped in <b></b>. If the text below has no usable sentence, invent a short natural one.
- lang: the BCP-47 language code of "${word}" itself, i.e. the language it needs to be pronounced in (e.g. "de", "en", "ru", "ja") — not the language of the translation.

Examples:
- "vollenden" → article: "", translation: "завершить", notes: "voll ('full') + enden ('to end') — to bring something fully to its end.", lang: "de"
- "Handschuh" → article: "der", translation: "перчатка", notes: "Hand + Schuh ('shoe') — literally a 'shoe for the hand'.", lang: "de"
- "Wetter" → article: "das", translation: "погода", notes: "the English cognate 'weather' — literally the same word.", lang: "de"

Page URL: ${url || ""}

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

function buildRefPrompt(text, context, url) {
  return `I am fluent in English, Russian. Translate and explain the text between the === markers, which I selected while reading the context below.

Provide two fields:
- translation: the selected text translated into Russian — or, if it is already in Russian, into English. Expand abbreviations. Translate only the text between the markers.
- notes: a concise note (max ~50 words) that helps the reader truly understand it. Write the note in English. If it contains or alludes to a literary, historical, or cultural reference, a named work or person, a joke, an allusion, an idiom, or a double meaning — explain what it refers to and, if it is used ironically or rhetorically or as a joke, what the actual point is. If the text is plain with no such reference, just briefly clarify its meaning, nuance, or tone. But don't just rephrase the translation.

Selected text:
===
${text}
===

Page URL: ${url || ""}

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

// --- Text-to-speech (Google Translate) ---

// Content scripts can't set a Referer header, and translate_tts silently
// returns a non-audio body without one — so the fetch has to happen here,
// where the extension can set it.
async function fetchSpeech(text, lang) {
  const tl = (lang || "en").split("-")[0];
  const url =
    "https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=" +
    encodeURIComponent(tl) +
    "&q=" +
    encodeURIComponent(text);

  const resp = await fetch(url, {
    headers: { Referer: "https://translate.google.com/" },
  });
  if (!resp.ok) throw new Error(`TTS fetch failed: ${resp.status}`);

  const bytes = new Uint8Array(await resp.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return "data:audio/mpeg;base64," + btoa(binary);
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

// Streaming translate requests use a long-lived port instead of one-shot
// sendMessage, so the content script can render partial text as it arrives.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "translate") return;

  port.onMessage.addListener((msg) => {
    if (msg.action !== "translate") return;

    let prompt, schema;
    const url = (msg.url || "").substring(0, 200);
    if (msg.isSingleWord) {
      prompt = buildWordPrompt(msg.text, msg.context, url);
      schema = WORD_SCHEMA;
    } else if (countWords(msg.text) > 100) {
      prompt = buildSummaryPrompt(msg.text);
      schema = TRANSLATE_SCHEMA;
    } else {
      prompt = buildRefPrompt(msg.text, msg.context, url);
      schema = REF_SCHEMA;
    }

    callModel(prompt, schema, (partial) => {
      try {
        port.postMessage({ type: "chunk", text: partial });
      } catch {}
    })
      .then((result) => {
        try {
          port.postMessage({ type: "done", result });
        } catch {}
      })
      .catch((err) => {
        try {
          port.postMessage({ type: "error", error: err.message });
        } catch {}
      });
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
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

  if (msg.action === "speak") {
    fetchSpeech(msg.text, msg.lang)
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
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
