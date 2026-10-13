import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

// A Meridian card whose body can be minimized. Native <details>/<summary> rather than a
// useState-driven panel — free keyboard support, and React only touches the `open` DOM
// attribute when the prop value itself changes between renders, so a user's manual toggle
// survives a page's polling refetch (defaultOpen never changes after mount).
export default function Collapsible({
  title,
  hint,
  actions,
  children,
  defaultOpen = true,
  id,
}: {
  title: ReactNode;
  // Short secondary text after the title ("· 12 assigned").
  hint?: ReactNode;
  // Right-aligned header content (badge, small button). Clicks inside it don't toggle.
  actions?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  // Optional DOM id — lets a click elsewhere on the page (e.g. a summary tile) force
  // this panel open and scroll to it via document.getElementById, without having to
  // thread open-state through props (see AgentsPage's "Unmanaged" tile).
  id?: string;
}) {
  return (
    <details className="ep-card app-collapsible" open={defaultOpen} id={id}>
      <summary className="ep-ch">
        <ChevronRight size={16} strokeWidth={1.7} className="ep-ic app-collapsible-chev" aria-hidden />
        <h3>{title}</h3>
        {hint && <span className="ep-hint">· {hint}</span>}
        {actions && (
          <div className="ep-r" onClick={(e) => e.preventDefault()}>
            {actions}
          </div>
        )}
      </summary>
      <div className="ep-cb">{children}</div>
    </details>
  );
}
