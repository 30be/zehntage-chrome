const keyInput = document.getElementById("key");
const sitesInput = document.getElementById("sites");
const saveBtn = document.getElementById("save");
const statusEl = document.getElementById("status");
const wordCountEl = document.getElementById("word-count");

// Load existing settings
chrome.storage.local.get(["apiKey", "sitePatterns", "words"], ({ apiKey, sitePatterns, words }) => {
  if (apiKey) {
    keyInput.value = apiKey;
    statusEl.textContent = "Key saved.";
  }
  if (sitePatterns) {
    sitesInput.value = sitePatterns.join("\n");
  }
  const count = words ? Object.keys(words).length : 0;
  wordCountEl.textContent = `${count} word${count !== 1 ? "s" : ""} in list`;
});

saveBtn.addEventListener("click", () => {
  const key = keyInput.value.trim();
  if (!key) {
    statusEl.textContent = "Enter a key first.";
    return;
  }

  const sitePatterns = sitesInput.value
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  chrome.storage.local.set({ apiKey: key, sitePatterns }, () => {
    statusEl.textContent = "Saved!";
    setTimeout(() => (statusEl.textContent = "Key saved."), 1500);
  });
});
