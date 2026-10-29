import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { BookOpen, ChevronDown, ChevronRight, MousePointerClick, Search, X } from "lucide-react";
import { Button } from "../components/ui";
import { findTarget, searchHelp, topicForPath, type HelpTopic, type HowTo } from "./index";

// Help Center plumbing: the side panel ("?" in the top bar), and "Show me" - a step-by-step
// overlay that highlights the real button, tab or field for each step of a how-to.

interface HelpApi {
  panelOpen: boolean;
  togglePanel: () => void;
  closePanel: () => void;
  startTour: (howTo: HowTo) => void;
}

const HelpContext = createContext<HelpApi | null>(null);

export function useHelp(): HelpApi {
  const ctx = useContext(HelpContext);
  if (!ctx) throw new Error("useHelp must be used inside HelpProvider");
  return ctx;
}

export function HelpProvider({ children }: { children: ReactNode }) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [tour, setTour] = useState<HowTo | null>(null);

  const api = useMemo<HelpApi>(
    () => ({
      panelOpen,
      togglePanel: () => setPanelOpen((v) => !v),
      closePanel: () => setPanelOpen(false),
      startTour: (howTo) => {
        setPanelOpen(false);
        setTour(howTo);
      },
    }),
    [panelOpen],
  );

  return (
    <HelpContext.Provider value={api}>
      {children}
      {panelOpen && <HelpPanel onClose={() => setPanelOpen(false)} />}
      {tour && <Tour howTo={tour} onClose={() => setTour(null)} />}
    </HelpContext.Provider>
  );
}

// ---- a topic, as shown in the panel and on the Help page

export function HowToItem({ howTo, defaultOpen = false }: { howTo: HowTo; defaultOpen?: boolean }) {
  const { startTour } = useHelp();
  const [open, setOpen] = useState(defaultOpen);
  const Chevron = open ? ChevronDown : ChevronRight;
  const canShow = howTo.steps.some((s) => s.target || s.route);
  return (
    <div className="app-help-howto">
      <div className="app-help-howto-head">
        <button type="button" className="app-help-howto-title" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <Chevron size={16} strokeWidth={1.7} className="ep-ic" aria-hidden />
          {howTo.title}
        </button>
        {canShow && (
          <Button size="sm" icon={MousePointerClick} onClick={() => startTour(howTo)}>
            Show me
          </Button>
        )}
      </div>
      {open && (
        <ol className="app-help-steps">
          {howTo.steps.map((s, i) => (
            <li key={i}>{s.text}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function TopicView({ topic, highlightHowTos }: { topic: HelpTopic; highlightHowTos?: HowTo[] }) {
  const howTos = [...(highlightHowTos ?? []), ...(topic.howTos ?? []).filter((h) => !highlightHowTos?.includes(h))];
  return (
    <div className="app-stack">
      <div className="app-stack-sm">
        <span className="ep-hint">{topic.module}</span>
        <h3 className="app-help-title">{topic.title}</h3>
        <p className="app-text">{topic.summary}</p>
      </div>
      {howTos.length > 0 && (
        <div className="app-stack-sm">
          <span className="app-subhead">How to</span>
          {howTos.map((h, i) => (
            <HowToItem key={h.id} howTo={h} defaultOpen={i === 0 && !!highlightHowTos?.length} />
          ))}
        </div>
      )}
      {(topic.sections ?? []).map((s) => (
        <div key={s.title} className="app-stack-sm">
          <span className="app-subhead">{s.title}</span>
          <ul className="app-help-list">
            {s.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ---- the side panel

function HelpPanel({ onClose }: { onClose: () => void }) {
  const location = useLocation();
  const [query, setQuery] = useState("");
  const topic = topicForPath(location.pathname);
  const results = useMemo(() => searchHelp(query).slice(0, 8), [query]);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    panelRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <aside ref={panelRef} className="app-help-panel" role="dialog" aria-label="Help" data-help-ui>
      <header className="app-help-panel-head">
        <b>Help</b>
        <button type="button" className="ep-iconbtn" aria-label="Close help" onClick={onClose}>
          <X size={16} strokeWidth={1.7} className="ep-ic" aria-hidden />
        </button>
      </header>
      <div className="app-help-panel-body">
        <div className="ep-input-icon">
          <Search size={16} strokeWidth={1.7} className="ep-ic" aria-hidden />
          <input type="search" className="ep-input" placeholder="How do I…" aria-label="Search help" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {query.trim() ? (
          results.length === 0 ? (
            <div className="ep-empty">
              <p>Nothing matches "{query}". Try other words, or browse the Help Center.</p>
            </div>
          ) : (
            results.map((r) => (
              <div key={r.topic.id} className="ep-card app-help-result">
                <TopicView topic={r.topic} highlightHowTos={r.howTos} />
              </div>
            ))
          )
        ) : topic ? (
          <TopicView topic={topic} />
        ) : (
          <p className="app-text">Search above, or browse every module in the Help Center.</p>
        )}
      </div>
      <footer className="app-help-panel-foot">
        <Link className="ep-link" to="/help" onClick={onClose}>
          <BookOpen size={16} strokeWidth={1.7} className="ep-ic" aria-hidden /> Open the Help Center
        </Link>
      </footer>
    </aside>,
    document.body,
  );
}

// ---- "Show me"

function Tour({ howTo, onClose }: { howTo: HowTo; onClose: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [index, setIndex] = useState(0);
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [searching, setSearching] = useState(false);
  const step = howTo.steps[index];
  const last = index === howTo.steps.length - 1;

  const next = useCallback(() => (last ? onClose() : setIndex((i) => i + 1)), [last, onClose]);

  // Open the step's page, then look for its target for up to 5 seconds (pages load data first).
  useEffect(() => {
    setEl(null);
    setRect(null);
    if (step.route && location.pathname !== step.route) {
      navigate(step.route);
      return;
    }
    if (!step.target) return;
    setSearching(true);
    let tries = 0;
    const timer = window.setInterval(() => {
      const found = findTarget(step.target!);
      if (found || ++tries > 25) {
        window.clearInterval(timer);
        setSearching(false);
        if (found) {
          found.scrollIntoView({ block: "center", behavior: "smooth" });
          setEl(found);
        }
      }
    }, 200);
    return () => window.clearInterval(timer);
  }, [step, location.pathname, navigate]);

  // Follow the element as the page scrolls or resizes; clicking it moves to the next step.
  useLayoutEffect(() => {
    if (!el) return;
    let frame = 0;
    const update = () => {
      setRect(el.isConnected ? el.getBoundingClientRect() : null);
      frame = requestAnimationFrame(update);
    };
    update();
    const onClick = () => window.setTimeout(next, 300);
    el.addEventListener("click", onClick);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("click", onClick);
    };
  }, [el, next]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pad = 6;
  const below = rect ? rect.bottom + 180 < window.innerHeight : true;
  const cardStyle: React.CSSProperties = rect
    ? {
        top: below ? rect.bottom + pad + 10 : undefined,
        bottom: below ? undefined : window.innerHeight - rect.top + pad + 10,
        left: Math.max(16, Math.min(rect.left, window.innerWidth - 376)),
      }
    : { right: 24, bottom: 24 };

  return createPortal(
    <div className="app-tour" data-help-ui>
      {rect && (
        <div
          className="app-tour-spot"
          style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }}
          aria-hidden
        />
      )}
      <div className="app-tour-card ep-card" role="dialog" aria-label={howTo.title} style={cardStyle}>
        <div className="app-help-howto-head">
          <span className="ep-hint">
            {howTo.title} · step <span className="ep-num">{index + 1}</span> of <span className="ep-num">{howTo.steps.length}</span>
          </span>
          <button type="button" className="ep-iconbtn" aria-label="Close guide" onClick={onClose}>
            <X size={16} strokeWidth={1.7} className="ep-ic" aria-hidden />
          </button>
        </div>
        <p className="app-text">{step.text}</p>
        {step.target && !el && !searching && (
          <p className="ep-hint">Couldn't find "{step.target.label}" on this screen. It may need a selection first, or you may not have access to it.</p>
        )}
        <div className="app-actions-row app-end">
          {index > 0 && <Button onClick={() => setIndex((i) => i - 1)}>Back</Button>}
          <Button variant="primary" onClick={next}>
            {last ? "Done" : "Next"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
