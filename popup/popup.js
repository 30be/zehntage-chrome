const keyInput = document.getElementById("key");
const groqKeyInput = document.getElementById("groq-key");
const claudeKeyInput = document.getElementById("claude-key");
const cerebrasKeyInput = document.getElementById("cerebras-key");
const providerInput = document.getElementById("provider");
const ankiUrlInput = document.getElementById("anki-url");
const ankiKeyInput = document.getElementById("anki-key");
const sitesInput = document.getElementById("sites");
const saveBtn = document.getElementById("save");
const statusEl = document.getElementById("status");
const wordCountEl = document.getElementById("word-count");

// Load existing settings
chrome.storage.local.get(
  ["apiKey", "groqApiKey", "claudeApiKey", "cerebrasApiKey", "groqModel", "provider", "ankiUrl", "ankiKey", "sitePatterns", "words"],
  ({ apiKey, groqApiKey, claudeApiKey, cerebrasApiKey, groqModel, provider, ankiUrl, ankiKey, sitePatterns, words }) => {
    if (apiKey) {
      keyInput.value = apiKey;
      statusEl.textContent = "Key saved.";
    }
    if (groqApiKey) {
      groqKeyInput.value = groqApiKey;
    }
    if (claudeApiKey) {
      claudeKeyInput.value = claudeApiKey;
    }
    if (cerebrasApiKey) {
      cerebrasKeyInput.value = cerebrasApiKey;
    }
    providerInput.value =
      provider === "groq"
        ? groqModel === "qwen/qwen3.6-27b"
          ? "groq-qwen"
          : groqModel === "openai/gpt-oss-20b"
            ? "groq-20b"
            : "groq-120b"
        : provider === "claude"
          ? "claude"
          : provider === "cerebras"
            ? "cerebras"
            : "gemini";
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
  const choice = providerInput.value;
  const provider = choice.startsWith("groq")
    ? "groq"
    : choice === "claude" || choice === "cerebras"
      ? choice
      : "gemini";
  const groqModel =
    choice === "groq-20b"
      ? "openai/gpt-oss-20b"
      : choice === "groq-qwen"
        ? "qwen/qwen3.6-27b"
        : "openai/gpt-oss-120b";
  const key = keyInput.value.trim();
  const groqKey = groqKeyInput.value.trim();
  const claudeKey = claudeKeyInput.value.trim();
  const cerebrasKey = cerebrasKeyInput.value.trim();
  if (provider === "gemini" && !key) {
    statusEl.textContent = "Enter the Gemini key first.";
    return;
  }
  if (provider === "groq" && !groqKey) {
    statusEl.textContent = "Enter the Groq key first.";
    return;
  }
  if (provider === "claude" && !claudeKey) {
    statusEl.textContent = "Enter the Anthropic key first.";
    return;
  }
  if (provider === "cerebras" && !cerebrasKey) {
    statusEl.textContent = "Enter the Cerebras key first.";
    return;
  }

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
    { apiKey: key, groqApiKey: groqKey, claudeApiKey: claudeKey, cerebrasApiKey: cerebrasKey, provider, groqModel, ankiUrl, ankiKey, sitePatterns },
    () => {
      ankiUrlInput.value = ankiUrl;
      statusEl.textContent = "Saved!";
      setTimeout(() => (statusEl.textContent = "Key saved."), 1500);
    }
  );
});
