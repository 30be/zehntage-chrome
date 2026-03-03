const keyInput = document.getElementById("key");
const saveBtn = document.getElementById("save");
const status = document.getElementById("status");
const wordCount = document.getElementById("word-count");

// Load existing key
chrome.storage.local.get(["apiKey", "words"], ({ apiKey, words }) => {
  if (apiKey) {
    keyInput.value = apiKey;
    status.textContent = "Key saved.";
  }
  const count = words ? Object.keys(words).length : 0;
  wordCount.textContent = `${count} word${count !== 1 ? "s" : ""} in list`;
});

saveBtn.addEventListener("click", () => {
  const key = keyInput.value.trim();
  if (!key) {
    status.textContent = "Enter a key first.";
    return;
  }
  chrome.storage.local.set({ apiKey: key }, () => {
    status.textContent = "Saved!";
    setTimeout(() => (status.textContent = "Key saved."), 1500);
  });
});
