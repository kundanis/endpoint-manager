import { Check } from "lucide-react";
import { createContext, useCallback, useContext, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";
import { Field } from "./form";
import Modal from "./Modal";

// Promise-based replacements for window.confirm / window.prompt / window.alert, rendered as
// Meridian modals and toasts (COMPONENTS.md §15–16). Mount <DialogProvider> once at the root.

export interface ConfirmOptions {
  title: ReactNode;
  body?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  // "danger" uses the solid danger button; reserve it for destructive or disruptive actions.
  tone?: "danger" | "default";
}

export interface PromptOptions {
  title: ReactNode;
  body?: ReactNode;
  label: string;
  confirmLabel: string;
  type?: "text" | "password";
  help?: string;
  // Return an error message to block submission, or null when the value is acceptable.
  validate?: (value: string) => string | null;
}

type DialogRequest = { id: number } & (
  | { kind: "confirm"; options: ConfirmOptions; resolve: (ok: boolean) => void }
  | { kind: "prompt"; options: PromptOptions; resolve: (value: string | null) => void }
);

interface ToastItem {
  id: number;
  message: ReactNode;
}

interface DialogApi {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
  toast: (message: ReactNode) => void;
}

const DialogContext = createContext<DialogApi | null>(null);

const TOAST_MS = 4000;

function ConfirmDialog({ options, onDone }: { options: ConfirmOptions; onDone: (ok: boolean) => void }) {
  return (
    <Modal
      title={options.title}
      description={options.body}
      onClose={() => onDone(false)}
      footer={
        <>
          <Button onClick={() => onDone(false)}>{options.cancelLabel ?? "Cancel"}</Button>
          <Button variant={options.tone === "danger" ? "danger-solid" : "primary"} onClick={() => onDone(true)}>
            {options.confirmLabel}
          </Button>
        </>
      }
    />
  );
}

function PromptDialog({ options, onDone }: { options: PromptOptions; onDone: (value: string | null) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const formId = useRef(`prompt-${Math.random().toString(36).slice(2)}`).current;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const problem = options.validate?.(value) ?? null;
    if (problem) {
      setError(problem);
      return;
    }
    onDone(value);
  }

  return (
    <Modal
      title={options.title}
      description={options.body}
      onClose={() => onDone(null)}
      footer={
        <>
          <Button onClick={() => onDone(null)}>Cancel</Button>
          <Button variant="primary" type="submit" form={formId}>
            {options.confirmLabel}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} noValidate>
        <Field label={options.label} htmlFor={`${formId}-input`} help={options.help} error={error ?? undefined}>
          <input
            id={`${formId}-input`}
            data-autofocus
            className={`ep-input ${error ? "ep-invalid" : ""}`}
            type={options.type ?? "text"}
            autoComplete={options.type === "password" ? "new-password" : "off"}
            value={value}
            aria-invalid={error ? true : undefined}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError(null);
            }}
          />
        </Field>
      </form>
    </Modal>
  );
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<DialogRequest[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        const id = nextId.current++;
        setQueue((q) => [...q, { id, kind: "confirm", options, resolve }]);
      }),
    [],
  );
  const prompt = useCallback(
    (options: PromptOptions) =>
      new Promise<string | null>((resolve) => {
        const id = nextId.current++;
        setQueue((q) => [...q, { id, kind: "prompt", options, resolve }]);
      }),
    [],
  );
  const toast = useCallback((message: ReactNode) => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, message }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), TOAST_MS);
  }, []);

  const current = queue[0];
  function finish(result: boolean | string | null) {
    if (!current) return;
    (current.resolve as (r: typeof result) => void)(result);
    setQueue((q) => q.slice(1));
  }

  return (
    <DialogContext.Provider value={{ confirm, prompt, toast }}>
      {children}
      {current?.kind === "confirm" && <ConfirmDialog key={current.id} options={current.options} onDone={finish} />}
      {current?.kind === "prompt" && <PromptDialog key={current.id} options={current.options} onDone={finish} />}
      <ToastStack toasts={toasts} />
    </DialogContext.Provider>
  );
}

// Always mounted (even when empty) so screen readers announce toasts as they're added.
function ToastStack({ toasts }: { toasts: ToastItem[] }) {
  return createPortal(
    <div className="app-overlay app-toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="ep-toast">
          <Check size={16} strokeWidth={1.7} className="ep-ic" aria-hidden />
          {t.message}
        </div>
      ))}
    </div>,
    document.body,
  );
}

function useDialogApi(): DialogApi {
  const api = useContext(DialogContext);
  if (!api) throw new Error("DialogProvider is missing above this component");
  return api;
}

export function useConfirm() {
  return useDialogApi().confirm;
}

export function usePrompt() {
  return useDialogApi().prompt;
}

export function useToast() {
  return useDialogApi().toast;
}
