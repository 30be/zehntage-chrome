/**
 * Tests for background.js prompt building and response parsing.
 * Run with: node test_background.js
 *
 * These test the pure functions extracted from background.js without
 * needing the Chrome extension APIs.
 */

// --- Extract testable functions ---

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

function parseGeminiResponse(responseText) {
  const cleaned = responseText
    .replace(/^```json\s*/, "")
    .replace(/```\s*$/, "")
    .trim();
  return JSON.parse(cleaned);
}

function buildContextWithBold(context, word) {
  const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return context.replace(new RegExp(`(${escapedWord})`, "gi"), "<b>$1</b>");
}

// --- Test runner ---

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${message}`);
    console.error(`    expected: ${JSON.stringify(expected)}`);
    console.error(`    actual:   ${JSON.stringify(actual)}`);
  }
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ok: ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL: ${name} — ${err.message}`);
  }
}

// --- Tests ---

console.log("background.js tests:");

test("buildWordPrompt includes word and context", () => {
  const prompt = buildWordPrompt("Hund", "Der Hund ist groß");
  assert(prompt.includes('"Hund"'), "should contain the word");
  assert(prompt.includes("Der Hund ist groß"), "should contain context");
  assert(prompt.includes("translation"), "should mention translation field");
  assert(prompt.includes("notes"), "should mention notes field");
  assert(prompt.includes("context"), "should mention context field");
});

test("buildWordPrompt does not mention JSON or output format", () => {
  const prompt = buildWordPrompt("Hund", "Der Hund ist groß");
  assert(!prompt.includes("JSON"), "should not mention JSON");
  assert(!prompt.includes("===BEGIN==="), "should not contain old delimiters");
});

test("buildTranslatePrompt wraps text in === markers", () => {
  const prompt = buildTranslatePrompt("Der schnelle Fuchs");
  assert(prompt.includes("==="), "should have === markers");
  assert(prompt.includes("Der schnelle Fuchs"), "should contain the text");
  assert(!prompt.includes("notes"), "should not ask for notes");
  assert(!prompt.includes("JSON"), "should not mention JSON");
});

test("parseGeminiResponse handles clean JSON", () => {
  const result = parseGeminiResponse('{"translation":"dog","notes":"Common pet"}');
  assertEqual(result.translation, "dog", "translation");
  assertEqual(result.notes, "Common pet", "notes");
});

test("parseGeminiResponse strips markdown fences", () => {
  const result = parseGeminiResponse(
    '```json\n{"translation":"cat","notes":""}\n```'
  );
  assertEqual(result.translation, "cat", "translation");
});

test("parseGeminiResponse handles whitespace", () => {
  const result = parseGeminiResponse(
    '  \n{"translation":"bird","notes":"flies"}  \n'
  );
  assertEqual(result.translation, "bird", "translation");
});

test("parseGeminiResponse throws on invalid JSON", () => {
  let threw = false;
  try {
    parseGeminiResponse("not json at all");
  } catch {
    threw = true;
  }
  assert(threw, "should throw on invalid JSON");
});

test("buildContextWithBold highlights word case-insensitively", () => {
  const result = buildContextWithBold("Der Hund ist ein hund", "hund");
  assertEqual(
    result,
    "Der <b>Hund</b> ist ein <b>hund</b>",
    "should bold all occurrences"
  );
});

test("buildContextWithBold handles special regex chars", () => {
  const result = buildContextWithBold("test (word) here", "(word)");
  assertEqual(
    result,
    "test <b>(word)</b> here",
    "should handle parens in word"
  );
});

test("buildWordPrompt includes example translations", () => {
  const prompt = buildWordPrompt("test", "some context");
  assert(
    prompt.includes("vollenden → завершить"),
    "should include vollenden example"
  );
  assert(
    prompt.includes("Feierabend → конец рабочего дня"),
    "should include Feierabend example"
  );
});

test("buildTranslatePrompt translates only the marked text", () => {
  const prompt = buildTranslatePrompt("some text");
  assert(
    prompt.includes("Translate only that text, nothing else."),
    "should instruct to translate only the marked text"
  );
});

// --- Summary ---

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
