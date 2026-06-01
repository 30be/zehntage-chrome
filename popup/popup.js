const keyInput = document.getElementById("key");
const anthropicKeyInput = document.getElementById("anthropic-key");
const ankiUrlInput = document.getElementById("anki-url");
const ankiKeyInput = document.getElementById("anki-key");
const sitesInput = document.getElementById("sites");
const saveBtn = document.getElementById("save");
const statusEl = document.getElementById("status");
const wordCountEl = document.getElementById("word-count");

// Load existing settings
chrome.storage.local.get(
  ["apiKey", "anthropicKey", "ankiUrl", "ankiKey", "sitePatterns", "words"],
  ({ apiKey, anthropicKey, ankiUrl, ankiKey, sitePatterns, words }) => {
    if (apiKey) {
      keyInput.value = apiKey;
      statusEl.textContent = "Key saved.";
    }
    if (anthropicKey) {
      anthropicKeyInput.value = anthropicKey;
    }
    if (ankiUrl) {
      ankiUrlInput.value = ankiUrl;
    }
    if (ankiKey) {
      ankiKeyInput.value = ankiKey;
    }
    if (sitePatterns) {
      sitesInput.value = sitePatterns.join("\n");
    }
    const count = words ? Object.keys(words).length : 0;
    wordCountEl.textContent = `${count} word${count !== 1 ? "s" : ""} in list`;
  }
);

saveBtn.addEventListener("click", () => {
  const key = keyInput.value.trim();
  if (!key) {
    statusEl.textContent = "Enter a key first.";
    return;
  }

  const anthropicKey = anthropicKeyInput.value.trim();

  // Normalize the MCP URL: strip a trailing /mcp and any trailing slashes.
  const ankiUrl = ankiUrlInput.value
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/mcp$/, "")
    .replace(/\/+$/, "");
  const ankiKey = ankiKeyInput.value.trim();

  const sitePatterns = sitesInput.value
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  chrome.storage.local.set(
    { apiKey: key, anthropicKey, ankiUrl, ankiKey, sitePatterns },
    () => {
      ankiUrlInput.value = ankiUrl;
      statusEl.textContent = "Saved!";
      setTimeout(() => (statusEl.textContent = "Key saved."), 1500);
    }
  );
});
