import type { ReactNode } from "react";

// Native <details>/<summary> rather than a useState-driven panel — free keyboard
// support, and React only touches the `open` DOM attribute when the prop value
// itself changes between renders, so a user's manual toggle survives this page's
// 5s polling refetch (defaultOpen never changes after mount).
export default function Collapsible({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="panel" open={defaultOpen}>
      <summary>{title}</summary>
      {children}
    </details>
  );
}
