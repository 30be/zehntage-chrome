/**
 * Tests for content.js selection-gesture handling.
 * Run with: node test_content.js
 *
 * These test the pure function extracted from content.js without
 * needing the Chrome extension APIs.
 */

// --- Extract testable functions ---

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

console.log("content.js selection-gesture tests:");

test("normal selection (no prior popup) shows", () => {
  assert(isPureDismissal(false, "", "Hund") === false);
});

test("pure dismissal with no selection is suppressed", () => {
  assert(isPureDismissal(true, "foo", "") === true);
});

test("pure dismissal with stale unchanged selection is suppressed", () => {
  assert(isPureDismissal(true, "foo", "foo") === true);
});

test("BUG: new selection via press-drag while popup open must show", () => {
  assert(isPureDismissal(true, "", "And I am wound so tightly") === false);
});

test("BUG: multi-click then drag extends selection must show", () => {
  assert(
    isPureDismissal(
      true,
      "When it's at its darkest",
      "When it's at its darkest, it's my favourite bit\nAnd I am wound so tightly"
    ) === false
  );
});

test("dismiss then brand-new different selection must show", () => {
  assert(isPureDismissal(true, "alt", "neu") === false);
});

// Simulate the mouseup/dismiss sequencing protocol.
function makeSeq() {
  let seq = 0;
  return {
    startLookup: () => ++seq,      // a new selection begins a lookup
    dismiss: () => { seq++; },     // dismiss/Escape invalidates in-flight
    seq: () => seq,
  };
}

test("single lookup renders its own response", () => {
  const s = makeSeq();
  const gen = s.startLookup();
  assert(shouldRender(gen, s.seq()) === true);
});

test("RACE: out-of-order response from older selection is dropped", () => {
  const s = makeSeq();
  const genA = s.startLookup();
  const genB = s.startLookup();
  assert(shouldRender(genA, s.seq()) === false); // A is stale
  assert(shouldRender(genB, s.seq()) === true);  // B is current
});

test("RACE: response after dismissal does not re-open popup", () => {
  const s = makeSeq();
  const genA = s.startLookup();
  s.dismiss();
  assert(shouldRender(genA, s.seq()) === false);
});

// --- Streaming preview: partial JSON ---

// Load the real parser from content.js (the "Streaming preview" section up to
// previewHtml, which needs the DOM helpers) instead of a drifting copy.
const src = require("fs").readFileSync(__dirname + "/content.js", "utf8");
const section = src.slice(src.indexOf("// --- Streaming preview ---"), src.indexOf("// The popup body for a half-streamed"));
const { parsePartialJson } = new Function(section + "\nreturn { parsePartialJson };")();

// Every prefix of a full answer: never throws, every field is a prefix of its
// final value (nothing half-decoded ever shows), and the whole text parses
// exactly like JSON.parse.
function checkAllPrefixes(name, full) {
  test(`partial JSON: every prefix of ${name}`, () => {
    const final = JSON.parse(full.slice(full.indexOf("{"), full.lastIndexOf("}") + 1));
    let bad = 0;
    for (let n = 0; n <= full.length; n++) {
      const { fields } = parsePartialJson(full.slice(0, n));
      for (const [k, v] of Object.entries(fields)) {
        const f = final[k];
        const ok = typeof v === "string" ? typeof f === "string" && f.startsWith(v) : v === f;
        if (!ok && bad++ < 3) console.error(`    prefix ${n}: ${k}=${JSON.stringify(v)}`);
      }
    }
    assert(bad === 0, `${bad} prefixes produced a wrong field`);
    assert(JSON.stringify(parsePartialJson(full).fields) === JSON.stringify(final), "complete text equals JSON.parse");
  });
}

checkAllPrefixes(
  "a word answer",
  '{"article":"","translation":"важный","notes":"From Latin importare, \'to bring in\'","context":"an <b>important</b> problem"}'
);
checkAllPrefixes(
  "escapes, \\u and surrogate pairs",
  '{"translation":"\\u0436\\u0438\\u0442\\u044c \\"quoted\\" a\\\\b","notes":"line1\\nline2 \\ud83d\\ude00 end\\t/"}'
);
checkAllPrefixes("pretty-printed with numbers and booleans", '{\n  "translation": "x",\n  "n": -12.5e2,\n  "ok": true,\n  "z": null\n}');
checkAllPrefixes("a ```json fence around it", '```json\n{"translation":"перчатка","notes":"Hand + Schuh"}\n```');

test("partial JSON: open field is reported, closed ones are not", () => {
  assertEqual(parsePartialJson('{"translation":"важ').open, "translation", "open string");
  assertEqual(parsePartialJson('{"translation":"важный",').open, null, "closed string");
  assertEqual(parsePartialJson('{"translation":').open, "translation", "value not started");
  assertEqual(parsePartialJson('{"transl').open, null, "half a key is not a field");
});

test("partial JSON: half literals and half escapes are held back", () => {
  assertEqual(JSON.stringify(parsePartialJson('{"ok":tru').fields), "{}", "half true");
  assertEqual(JSON.stringify(parsePartialJson('{"n":12').fields), "{}", "number may continue");
  assertEqual(parsePartialJson('{"t":"a\\').fields.t, "a", "lone backslash");
  assertEqual(parsePartialJson('{"t":"a\\u04').fields.t, "a", "half \\u escape");
  assertEqual(parsePartialJson('{"t":"a\\ud83d').fields.t, "a", "high surrogate without its pair");
});

test("partial JSON: no object yet → nothing", () => {
  assertEqual(JSON.stringify(parsePartialJson("Sure! Here")), '{"fields":{},"open":null}', "chatter only");
});

// --- Summary ---

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
