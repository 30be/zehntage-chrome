/**
 * Tests for background.js prompt building and response parsing.
 * Run with: node test_background.js
 *
 * These test the pure functions extracted from background.js without
 * needing the Chrome extension APIs.
 */

// --- Extract testable functions ---

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
  assert(prompt.includes("translation"), "should ask for translation");
  assert(prompt.includes("notes"), "should ask for notes");
});

test("buildTranslatePrompt wraps text in delimiters", () => {
  const prompt = buildTranslatePrompt("Der schnelle Fuchs");
  assert(prompt.includes("===BEGIN==="), "should have begin delimiter");
  assert(prompt.includes("===END==="), "should have end delimiter");
  assert(prompt.includes("Der schnelle Fuchs"), "should contain the text");
  assert(!prompt.includes("notes"), "should not ask for notes");
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
  assert(prompt.includes("Kutsche→carriage"), "should include Kutsche example");
  assert(
    prompt.includes("Schmetterling→butterfly"),
    "should include Schmetterling example"
  );
});

test("buildTranslatePrompt asks for JSON only", () => {
  const prompt = buildTranslatePrompt("some text");
  assert(
    prompt.includes('{"translation":"..."}'),
    "should show expected JSON format"
  );
});

// --- Summary ---

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
