// Options page: read-only connection status. The server address is set by the Endpoint IQ agent
// through browser policy and can't be changed here.
function check() {
  chrome.runtime.sendMessage({ type: "health" }, (res) => {
    const status = document.getElementById("status");
    status.textContent = res ? res.message : "No answer from the extension.";
    status.style.color = res && res.ok ? "#146c2e" : "#b3261e";
    // Access to the server's own address only - never to other sites. Asked for here because the
    // browser lets an extension request it only after a click.
    const allow = document.getElementById("allow");
    allow.hidden = !(res && res.origin && !res.granted);
    allow.onclick = () =>
      chrome.permissions.request({ origins: [res.origin] }, () => {
        check();
      });
  });
}
check();
