// Options page: read-only connection status. The server address is set by the Endpoint IQ agent
// through browser policy and can't be changed here.
chrome.runtime.sendMessage({ type: "health" }, (res) => {
  const status = document.getElementById("status");
  status.textContent = res ? res.message : "No answer from the extension.";
  status.style.color = res && res.ok ? "#146c2e" : "#b3261e";
});
