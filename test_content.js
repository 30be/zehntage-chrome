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

// --- Summary ---

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
