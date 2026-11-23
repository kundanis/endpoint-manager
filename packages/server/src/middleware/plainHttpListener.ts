import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";

// With HTTPS configured on its own port (TLS_PORT), the plain-HTTP port stays open only so
// agents enrolled against an http:// address keep checking in. Everything a browser uses -
// console, login, admin API, Outlook add-in - is sent to HTTPS instead, so an admin's
// password and session cookie never cross the network in clear text.
//
// Agents only ever call /api/agent/* (enroll included) and /health. /api/license-callback is
// the License Server's revoke notice, sent to whichever address this deployment registered.
const PLAIN_HTTP_PREFIXES = ["/api/agent", "/api/license-callback"];

export function isPlainHttpAllowedPath(url: string): boolean {
  const pathname = url.split("?")[0];
  if (pathname === "/health") return true;
  return PLAIN_HTTP_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

// https://<same host>[:port]<url>, or null when the Host header isn't a plain host name / IP
// (never echo arbitrary header text into a Location header).
export function httpsRedirectUrl(hostHeader: string | undefined, httpsPort: number, url: string): string | null {
  if (!hostHeader) return null;
  const match = /^(\[[0-9a-fA-F:.]+\]|[A-Za-z0-9.-]+)(?::\d+)?$/.exec(hostHeader.trim());
  if (!match) return null;
  const port = httpsPort === 443 ? "" : `:${httpsPort}`;
  const path = url.startsWith("/") ? url : "/";
  return `https://${match[1]}${port}${path}`;
}

export function plainHttpListener(app: RequestListener, httpsPort: number): RequestListener {
  return (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "/";
    if (isPlainHttpAllowedPath(url)) return app(req, res);

    const target = httpsRedirectUrl(req.headers.host, httpsPort, url);
    res.setHeader("Cache-Control", "no-store");
    // A page load or link is redirected. Anything else (a login POST, an API write) is
    // refused rather than redirected, so a client doesn't quietly keep using plain HTTP.
    if (target && (req.method === "GET" || req.method === "HEAD")) {
      res.statusCode = 301;
      res.setHeader("Location", target);
      res.end();
      return;
    }
    res.statusCode = 403;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: `This address only serves agents. Open the console over HTTPS${target ? `: ${target}` : ""}` }));
  };
}
