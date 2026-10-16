import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { SESSION_ENDED_EVENT } from "./api/client";
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
