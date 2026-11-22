import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Alert, Badge, Card, EmptyState, Skeleton, type BadgeTone } from "./ui";
import { useDashboardPosture, type PosturePart, type PostureRange } from "../api/hooks";
import { CHART_AXIS_TEXT, CHART_SEMANTIC } from "../chartTheme";

// Dashboard -> Organisation Security Posture, drawn like a stock price chart: the organisation's
// score (the average endpoint score, server-side in posture.service.ts) per day as a filled
// "mountain", scaled to the period's own range so rises and falls stand out. The line and its
// fill take the colour of the level they are at: green 80% and above, orange 60-79%, red below.
// Pointing at the chart shows that day's score in the headline. History starts the day the
// server first recorded it.

const RANGES: { value: PostureRange; short: string; label: string; since: string }[] = [
  { value: "week", short: "1W", label: "Week", since: "past week" },
  { value: "month", short: "1M", label: "Month", since: "past month" },
  { value: "quarter", short: "3M", label: "Quarter", since: "past quarter" },
  { value: "half", short: "6M", label: "Half Year", since: "past 6 months" },
  { value: "year", short: "1Y", label: "Year", since: "past year" },
];

const PART_LABEL: Record<PosturePart, string> = {
  vulnerabilities: "Vulnerabilities",
  patches: "Patches",
  zeroTrust: "Zero Trust",
  securityConfig: "Security configuration",
  threats: "Threats",
  policyBlocks: "Policy violations (7 days)",
};

const AT_RISK = 60;
const GOOD = 80;

function level(score: number): { tone: BadgeTone; label: string; color: string } {
  if (score >= GOOD) return { tone: "ok", label: "Good", color: CHART_SEMANTIC.ok };
  if (score >= AT_RISK) return { tone: "med", label: "Needs attention", color: CHART_SEMANTIC.warn };
  return { tone: "crit", label: "At risk", color: CHART_SEMANTIC.critical };
}

const dayMs = (day: string) => Date.parse(`${day}T00:00:00Z`);
const fmtDay = (day: string, withYear = false) =>
  new Date(dayMs(day)).toLocaleDateString(undefined, { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" });
const round1 = (n: number) => Math.round(n * 10) / 10;

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

type Point = { day: string; score: number };

export default function PostureTrendCard() {
  const [range, setRange] = useState<PostureRange>("month");
  const [hover, setHover] = useState<Point | null>(null);
  const { data, isLoading, error } = useDashboardPosture(range);
  const r = RANGES.find((x) => x.value === range)!;
  const points = data?.points ?? [];
  const current = data?.current?.score ?? null;
  const first = points.length > 1 ? points[0] : null;

  // The headline follows the pointer, like a stock app; otherwise it shows today's score.
  const shown = hover ?? (current !== null ? { day: points[points.length - 1]?.day ?? "", score: current } : null);
  const change = shown && first ? round1(shown.score - first.score) : null;
  const changePct = change !== null && first && first.score > 0 ? round1((change / first.score) * 100) : null;

  return (
    <Card title="Organisation Security Posture" hint={data?.current ? `${data.current.endpointCount} ${data.current.endpointCount === 1 ? "endpoint" : "endpoints"}` : undefined}>
      {isLoading ? (
        <Skeleton lines={6} />
      ) : error ? (
        <Alert tone="critical" title="Couldn't load the security posture">
          {(error as Error).message}
        </Alert>
      ) : !data || current === null || !shown ? (
        <EmptyState icon={ShieldCheck} title="No score yet">
          The score appears once an endpoint has checked in within the last 30 days.
        </EmptyState>
      ) : (
        <div className="app-posture-trend">
          <div className="app-posture-head">
            <div className="app-posture-score ep-num">{shown.score}%</div>
            <div className="app-posture-sub">
              {change !== null && (
                <span className={`app-posture-change ep-num ${change > 0 ? "is-up" : change < 0 ? "is-down" : ""}`}>
                  {change > 0 ? "▲" : change < 0 ? "▼" : "■"} {change > 0 ? "+" : ""}
                  {change} pts{changePct !== null ? ` (${changePct > 0 ? "+" : ""}${changePct}%)` : ""}
                </span>
              )}
              <span className="app-muted">{hover ? fmtDay(hover.day, true) : first ? r.since : "Today"}</span>
              <Badge tone={level(shown.score).tone}>{level(shown.score).label}</Badge>
            </div>
          </div>

          <MountainChart points={points} onHover={setHover} label={`Organisation security posture, ${r.since}`} />

          <div className="app-posture-ranges" role="group" aria-label="Period">
            {RANGES.map((x) => (
              <button
                key={x.value}
                type="button"
                className={x.value === range ? "is-on" : ""}
                aria-pressed={x.value === range}
                aria-label={x.label}
                title={x.label}
                onClick={() => {
                  setHover(null);
                  setRange(x.value);
                }}
              >
                {x.short}
              </button>
            ))}
          </div>

          {points.length < 2 && (
            <p className="app-muted">The chart builds up from the first day the server recorded the score, one point per day.</p>
          )}

          <PartsList parts={data.current!.parts} />

          {data.current!.eolCappedCount > 0 && (
            <p className="app-muted">
              <span className="ep-num">{data.current!.eolCappedCount}</span> endpoint
              {data.current!.eolCappedCount === 1 ? " runs" : "s run"} a Windows version past end of support and count at most 50%.
            </p>
          )}

          <details className="app-posture-table">
            <summary>Show as table</summary>
            <table className="ep-tbl">
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  <th scope="col" style={{ textAlign: "right" }}>
                    Score
                  </th>
                  <th scope="col">Level</th>
                </tr>
              </thead>
              <tbody>
                {[...points].reverse().map((p) => (
                  <tr key={p.day}>
                    <td>{fmtDay(p.day, true)}</td>
                    <td className="ep-num" style={{ textAlign: "right" }}>
                      {p.score}%
                    </td>
                    <td>{level(p.score).label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      )}
    </Card>
  );
}

function PartsList({ parts }: { parts: Partial<Record<PosturePart, number>> }) {
  const entries = (Object.keys(PART_LABEL) as PosturePart[]).filter((k) => parts[k] !== undefined);
  return (
    <ul className="app-posture-parts" aria-label="What makes up the score">
      {entries.map((k) => {
        const v = parts[k]!;
        return (
          <li key={k}>
            <span className="app-posture-part-name">{PART_LABEL[k]}</span>
            <span className="app-posture-part-bar" aria-hidden>
              <span style={{ width: `${v}%`, background: level(v).color }} />
            </span>
            <span className="ep-num">{Math.round(v)}%</span>
          </li>
        );
      })}
    </ul>
  );
}

const H = 240;
const PAD = { top: 16, right: 44, bottom: 24, left: 4 };

function MountainChart({ points, onHover, label }: { points: Point[]; onHover: (p: Point | null) => void; label: string }) {
  const uid = useId().replace(/:/g, "");
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hi, setHi] = useState<number | null>(null);
  const w = Math.max(width, 280);
  const innerW = w - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  // Scaled to the period's own range (with headroom), like a price chart, within 0-100%.
  const [lo, top] = useMemo(() => {
    if (points.length === 0) return [0, 100];
    const min = Math.min(...points.map((p) => p.score));
    const max = Math.max(...points.map((p) => p.score));
    const pad = Math.max(2, (max - min) * 0.12);
    return [Math.max(0, Math.floor(min - pad)), Math.min(100, Math.ceil(max + pad))];
  }, [points]);

  const t0 = points.length ? dayMs(points[0].day) : 0;
  const t1 = points.length ? dayMs(points[points.length - 1].day) : 1;
  const x = (day: string) => PAD.left + (points.length < 2 ? innerW / 2 : ((dayMs(day) - t0) / (t1 - t0)) * innerW);
  const y = (v: number) => PAD.top + (1 - (v - lo) / (top - lo || 1)) * innerH;
  const baseY = PAD.top + innerH;
  const peakY = points.length ? Math.min(...points.map((p) => y(p.score))) : PAD.top;

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.day).toFixed(1)},${y(p.score).toFixed(1)}`).join(" ");
  const area = points.length > 1 ? `${line} L${x(points[points.length - 1].day).toFixed(1)},${baseY} L${x(points[0].day).toFixed(1)},${baseY} Z` : "";
  const last = points[points.length - 1];
  const hp = hi !== null ? points[hi] : null;
  const guides = [GOOD, AT_RISK].filter((g) => g > lo && g < top);
  const ticks = points.length > 1 ? [points[0], points[Math.floor((points.length - 1) / 2)], last] : last ? [last] : [];

  // Level colours as hard stops in chart space, so the line and fill change colour at 60% and 80%.
  const stop = (v: number) => Math.min(1, Math.max(0, (y(v) - y(100)) / (y(0) - y(100) || 1)));

  function move(clientX: number, el: Element) {
    if (points.length === 0) return;
    const px = clientX - el.getBoundingClientRect().left + PAD.left;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(x(points[i].day) - px) < Math.abs(x(points[best].day) - px)) best = i;
    setHi(best);
    onHover(points[best]);
  }
  function leave() {
    setHi(null);
    onHover(null);
  }

  return (
    <div ref={ref} className="app-posture-chart">
      <svg width={w} height={H} role="img" aria-label={label}>
        <defs>
          <linearGradient id={`lvl-${uid}`} gradientUnits="userSpaceOnUse" x1="0" y1={y(100)} x2="0" y2={y(0)}>
            <stop offset={0} stopColor={CHART_SEMANTIC.ok} />
            <stop offset={stop(GOOD)} stopColor={CHART_SEMANTIC.ok} />
            <stop offset={stop(GOOD)} stopColor={CHART_SEMANTIC.warn} />
            <stop offset={stop(AT_RISK)} stopColor={CHART_SEMANTIC.warn} />
            <stop offset={stop(AT_RISK)} stopColor={CHART_SEMANTIC.critical} />
            <stop offset={1} stopColor={CHART_SEMANTIC.critical} />
          </linearGradient>
          {/* The fill fades out towards the bottom, like a price chart's mountain. */}
          <linearGradient id={`fade-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="white" stopOpacity={0.45} />
            <stop offset="1" stopColor="white" stopOpacity={0} />
          </linearGradient>
          <mask id={`mask-${uid}`} maskUnits="userSpaceOnUse" x={0} y={PAD.top} width={w} height={innerH}>
            <rect x={0} y={peakY} width={w} height={Math.max(1, baseY - peakY)} fill={`url(#fade-${uid})`} />
          </mask>
        </defs>

        {/* Level guides, labelled on the right */}
        {guides.map((g) => (
          <g key={g}>
            <line x1={PAD.left} x2={PAD.left + innerW} y1={y(g)} y2={y(g)} stroke="var(--ep-border)" strokeDasharray="2 4" />
            <text x={w - 4} y={y(g)} dy="0.32em" textAnchor="end" fontSize={11} fill={CHART_AXIS_TEXT} className="ep-num">
              {g}%
            </text>
          </g>
        ))}
        {/* Where the period started */}
        {points.length > 1 && (
          <line x1={PAD.left} x2={PAD.left + innerW} y1={y(points[0].score)} y2={y(points[0].score)} stroke="var(--ep-border-strong)" strokeDasharray="1 3" />
        )}

        {area && <path d={area} fill={`url(#lvl-${uid})`} mask={`url(#mask-${uid})`} />}
        {points.length > 1 && (
          <path d={line} fill="none" stroke={`url(#lvl-${uid})`} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        )}

        {/* Today's value */}
        {last && !hp && (
          <g>
            <circle cx={x(last.day)} cy={y(last.score)} r={9} fill={level(last.score).color} opacity={0.18} className="app-posture-pulse" />
            <circle cx={x(last.day)} cy={y(last.score)} r={4} fill={level(last.score).color} stroke="var(--ep-surface)" strokeWidth={2} />
          </g>
        )}

        {hp && (
          <g pointerEvents="none">
            <line x1={x(hp.day)} x2={x(hp.day)} y1={PAD.top} y2={baseY} stroke="var(--ep-border-strong)" />
            <circle cx={x(hp.day)} cy={y(hp.score)} r={5} fill={level(hp.score).color} stroke="var(--ep-surface)" strokeWidth={2} />
          </g>
        )}

        {ticks.map((p, i) => (
          <text
            key={`${p.day}-${i}`}
            x={x(p.day)}
            y={H - 6}
            textAnchor={ticks.length === 1 ? "middle" : i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle"}
            fontSize={11}
            fill={CHART_AXIS_TEXT}
          >
            {fmtDay(p.day)}
          </text>
        ))}

        <rect
          x={PAD.left}
          y={PAD.top}
          width={innerW}
          height={innerH}
          fill="transparent"
          style={{ touchAction: "pan-y" }}
          onPointerMove={(e) => move(e.clientX, e.currentTarget)}
          onPointerDown={(e) => move(e.clientX, e.currentTarget)}
          onPointerLeave={leave}
        />
      </svg>
    </div>
  );
}
