import type { ReactNode } from "react";

// Native <details>/<summary> rather than a useState-driven panel — free keyboard
// support, and React only touches the `open` DOM attribute when the prop value
// itself changes between renders, so a user's manual toggle survives this page's
// 5s polling refetch (defaultOpen never changes after mount).
export default function Collapsible({
  title,
  children,
  defaultOpen = true,
  id,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  // Optional DOM id — lets a click elsewhere on the page (e.g. a summary tile) force
  // this panel open and scroll to it via document.getElementById, without having to
  // thread open-state through props (see AgentsPage's "Unmanaged" tile).
  id?: string;
}) {
  return (
    <details className="panel" open={defaultOpen} id={id}>
      <summary>{title}</summary>
      {children}
    </details>
  );
}
