import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, ChevronRight } from "lucide-react";
import { useModuleVisibility, useNotifications } from "../api/hooks";
import type { ModuleVisibilityView, NotificationGroup } from "../api/types";
import { formatRelative } from "../format";
import { Badge } from "./ui";

// Top-bar alert bell (COMPONENTS.md §3): policy violations and matches from every module over
// the last 7 days, one line per kind, newest first. The red dot shows while something arrived
// since the bell was last opened. "Last opened" is remembered in this browser only (per admin
// email), so another browser or cleared site data shows the last 7 days as new again.

const ICON = { size: 18, strokeWidth: 1.7, "aria-hidden": true } as const;
const storageKey = (email: string) => `em:notifications-seen:${email.toLowerCase()}`;

function readSeen(email: string | undefined): string | null {
  if (!email) return null;
  try {
    return localStorage.getItem(storageKey(email));
  } catch {
    return null;
  }
}

function writeSeen(email: string | undefined, iso: string) {
  if (!email) return;
  try {
    localStorage.setItem(storageKey(email), iso);
  } catch {
    // storage unavailable: the dot just stays until the page reloads
  }
}

// A page hidden on this deployment (Licensing -> Module visibility) isn't offered.
function isHidden(v: ModuleVisibilityView | undefined, path: string): boolean {
  return !!v?.hiddenItemPaths.some((p) => path === p || path.startsWith(`${p}/`));
}

function meta(g: NotificationGroup): string {
  const parts = [`${g.module}`, `${g.total} in ${g.key === "access-requests" ? "total" : "7 days"}`];
  if (g.endpoints) parts.push(`${g.endpoints} ${g.endpoints === 1 ? "endpoint" : "endpoints"}`);
  if (g.latestAt) parts.push(formatRelative(g.latestAt));
  return parts.join(" · ");
}

export default function NotificationBell({ email }: { email?: string }) {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<string | null>(() => readSeen(email));
  const openedAt = useRef<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { data: visibility } = useModuleVisibility();
  const { data, isLoading, error } = useNotifications(seen);

  useEffect(() => setSeen(readSeen(email)), [email]);

  const groups = (data?.groups ?? []).filter((g) => !isHidden(visibility, g.path));
  const newTotal = groups.reduce((n, g) => n + g.newCount, 0);

  // Closing the panel marks everything that was there when it opened as seen.
  function close() {
    setOpen(false);
    if (openedAt.current) {
      writeSeen(email, openedAt.current);
      setSeen(openedAt.current);
      openedAt.current = null;
    }
  }

  function toggle() {
    if (open) return close();
    openedAt.current = new Date().toISOString();
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) close();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  });

  const label = newTotal > 0 ? `Alerts: ${newTotal} new` : "Alerts";

  return (
    <div className="app-account" ref={wrapRef}>
      <button type="button" className="ep-iconbtn" aria-label={label} title={label} aria-haspopup="dialog" aria-expanded={open} onClick={toggle}>
        <Bell {...ICON} />
        {newTotal > 0 && <span className="ep-dot" />}
      </button>
      {open && (
        <div className="ep-menu app-bell-panel" role="dialog" aria-label="Alerts">
          <div className="app-bell-head">
            <b>Alerts</b>
            <small>{newTotal > 0 ? `${newTotal} new since you last looked` : "Last 7 days"}</small>
          </div>
          <hr />
          {isLoading ? (
            <p className="app-bell-note">Loading…</p>
          ) : error ? (
            <p className="app-bell-note">Couldn't load alerts: {(error as Error).message}</p>
          ) : groups.length === 0 ? (
            <p className="app-bell-note">No policy violations or matches in the last 7 days.</p>
          ) : (
            <ul className="app-bell-list">
              {groups.map((g) => (
                <li key={g.key}>
                  <button
                    type="button"
                    onClick={() => {
                      close();
                      navigate(g.path);
                    }}
                  >
                    <span className="app-bell-text">
                      <span className="app-bell-title">
                        {g.title}
                        {g.newCount > 0 && <Badge tone={g.tone}>{g.newCount} new</Badge>}
                      </span>
                      <small>{meta(g)}</small>
                    </span>
                    <ChevronRight {...ICON} size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
