import { Ellipsis, type LucideIcon } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";

export interface MenuItem {
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  // Draw a divider above this item (destructive items usually sit last, after a divider).
  dividerBefore?: boolean;
}

// Row-actions menu (COMPONENTS.md §16): an ellipsis button that opens an ep-menu. Esc or a
// click outside closes it; arrow keys move between items.
export function RowMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const menuButtons = () => Array.from(wrapRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
    menuButtons()[0]?.focus();

    function onPointerDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const buttons = menuButtons();
      const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === "ArrowDown" ? (idx + 1) % buttons.length : (idx - 1 + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="app-menu-wrap" ref={wrapRef} onClick={(e) => e.stopPropagation()}>
      <button
        ref={triggerRef}
        type="button"
        className="ep-iconbtn"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Ellipsis size={16} strokeWidth={1.7} className="ep-ic" aria-hidden />
      </button>
      {open && (
        <div className="ep-menu app-menu-pop" role="menu">
          {items.map((item) => (
            <Fragment key={item.label}>
              {item.dividerBefore && <hr />}
              <button
                type="button"
                role="menuitem"
                className={item.danger ? "ep-danger" : undefined}
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.icon && <item.icon size={16} strokeWidth={1.7} className="ep-ic" aria-hidden />}
                {item.label}
              </button>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
