const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent";
const ANKI_URL = "http://localhost:8765";
const NATIVE_HOST = "com.zehntage.host";

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
  return `Translate the word "${word}" to English using context below. \
Notes: max 15 words. Only something that helps memorize: etymology, word roots, \
word structure, or a fun fact. No grammar info, no tense, no repeating context. \
Empty string if nothing useful. \
Examples:
- Kutsche→carriage: "From Hungarian kocsi, named after the town Kocs"
- Schmetterling→butterfly: "From Schmetten (cream) — butterflies were thought to steal milk"
- Angst→fear: "Same word borrowed into English as-is"
- Zeitgeist→spirit of the time: ""
Return ONLY valid JSON: {"translation":"...","notes":"..."}

Context:
${context}`;
}

function buildTranslatePrompt(text) {
  return `You are a translator. Your ONLY job is to translate the exact text between the \
delimiters below to English. Do NOT paraphrase, summarize, or translate any other text. \
Return ONLY valid JSON: {"translation":"..."}

===BEGIN===
${text}
===END===`;
}

// --- AnkiConnect ---

async function ankiRequest(action, params = {}) {
  const resp = await fetch(ANKI_URL, {
    method: "POST",
    body: JSON.stringify({ action, version: 6, params }),
  });
  const data = await resp.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

async function ankiAvailable() {
  try {
    await ankiRequest("version");
    return true;
  } catch {
    return false;
  }
}

async function ankiAddNote(word, translation, notes, context) {
  return ankiRequest("addNote", {
    note: {
      deckName: "ZehnTage",
      modelName: "Basic",
      fields: {
        Front: word,
        Back: translation + (notes ? "\n" + notes : ""),
      },
      tags: ["zehntage"],
      options: { allowDuplicate: false },
    },
  });
}

async function ankiGetAllWords() {
  const noteIds = await ankiRequest("findNotes", {
    query: "deck:ZehnTage tag:zehntage",
  });
  if (!noteIds || noteIds.length === 0) return {};
  const notesInfo = await ankiRequest("notesInfo", { notes: noteIds });
  const words = {};
  for (const note of notesInfo) {
    const front = (note.fields.Front.value || "").toLowerCase();
    if (front) {
      words[front] = {
        back: note.fields.Back.value || "",
        notes: "",
        context: "",
      };
    }
  }
  return words;
}

// --- Native messaging (TSV file I/O) ---

function nativeRead() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(NATIVE_HOST, { action: "read" }, (resp) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(resp);
      }
    });
  });
}

function nativeWrite(entry) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(
      NATIVE_HOST,
      { action: "write", entry },
      (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(resp);
        }
      }
    );
  });
}

// --- Word cache management ---

async function loadWords() {
  // Try AnkiConnect first, then native host, then cached storage
  let words = {};
  let source = "cache";

  try {
    if (await ankiAvailable()) {
      words = await ankiGetAllWords();
      source = "anki";
    }
  } catch {}

  if (source !== "anki") {
    try {
      const resp = await nativeRead();
      if (resp && resp.words) {
        words = resp.words;
        source = "native";
      }
    } catch {}
  }

  if (source === "cache") {
    const stored = await chrome.storage.local.get("words");
    words = stored.words || {};
  }

  await chrome.storage.local.set({ words });
  return words;
}

async function addWord(word, translation, notes, context) {
  // Build context with <b> tags around the word
  const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const contextWithBold = context.replace(
    new RegExp(`(${escapedWord})`, "gi"),
    "<b>$1</b>"
  );

  const entry = {
    front: word.toLowerCase(),
    back: translation,
    notes: notes || "",
    context: contextWithBold,
  };

  // Write to AnkiConnect if available
  let ankiOk = false;
  try {
    if (await ankiAvailable()) {
      await ankiAddNote(word, translation, notes, contextWithBold);
      ankiOk = true;
    }
  } catch {}

  // Always write to TSV as fallback/sync
  try {
    await nativeWrite(entry);
  } catch {}

  // Update local cache
  const { words = {} } = await chrome.storage.local.get("words");
  words[word.toLowerCase()] = {
    back: translation,
    notes: notes || "",
    context: contextWithBold,
  };
  await chrome.storage.local.set({ words });

  return { ankiOk };
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
