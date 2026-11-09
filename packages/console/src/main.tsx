import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { SESSION_ENDED_EVENT, api } from "./api/client";
import { DialogProvider } from "./components/ui";
// Meridian design system (design-system/CLAUDE.md). Order matters: fonts, then tokens, then
// the ep-* component styles, then the app's own CSS last so its legacy bridge can override
// the Meridian reset inside not-yet-migrated pages. Fonts are bundled (not Google Fonts)
// because the console is deployed on-premises, often without internet access.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "../design-system/tokens/tokens.css";
import "../design-system/css/meridian.css";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

// Any API call rejected as "not logged in" re-checks the session; once /auth/me fails too,
// RequireAuth sends the user to the login page (see api/client.ts).
window.addEventListener(SESSION_ENDED_EVENT, () => {
  void queryClient.invalidateQueries({ queryKey: ["me"] });
});

// Signs out after 30 minutes without mouse or keyboard use in any console tab. The pages'
// own auto-refresh would otherwise keep an unattended session alive on the server, which
// ends sessions after 30 minutes without requests (adminSession.service.ts). The last
// activity time is shared between tabs through localStorage.
const IDLE_SIGN_OUT_MS = 30 * 60 * 1000;
const ACTIVITY_KEY = "em:last-activity";
let lastActivity = Date.now();
function noteActivity() {
  const now = Date.now();
  if (now - lastActivity < 15_000) return;
  lastActivity = now;
  try {
    localStorage.setItem(ACTIVITY_KEY, String(now));
  } catch {
    // storage unavailable: this tab's own activity still counts
  }
}
for (const type of ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"]) {
  window.addEventListener(type, noteActivity, { passive: true });
}
window.setInterval(() => {
  let shared = 0;
  try {
    shared = Number(localStorage.getItem(ACTIVITY_KEY)) || 0;
  } catch {
    // ignore
  }
  const idleFor = Date.now() - Math.max(lastActivity, shared);
  if (idleFor < IDLE_SIGN_OUT_MS || !queryClient.getQueryData(["me"])) return;
  void api.post("/auth/logout").finally(() => queryClient.setQueryData(["me"], null));
}, 30_000);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <DialogProvider>
          <App />
        </DialogProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
