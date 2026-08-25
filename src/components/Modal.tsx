import { useEffect, useRef } from "react";

/** The application's standard centered modal dialog.
 *
 *  A single primitive every in-app dialog builds on, so they all share one look
 *  (bordered card on a dimmed backdrop) and one set of interactions — Escape and
 *  backdrop-click both close, focus moves inside on open. Introduced to replace the
 *  native `window.prompt` / `window.confirm` dialogs, which broke the app's visual
 *  language and read like a system error.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  icon,
  danger = false,
  children,
  footer,
  initialFocusRef,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  /** Tint the header icon in the danger colour (used by destructive confirmations). */
  danger?: boolean;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  /** Element to focus when the dialog opens (e.g. the primary input). */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    // Move focus into the dialog so typing/Enter work immediately.
    const t = window.setTimeout(() => {
      (initialFocusRef?.current ?? cardRef.current)?.focus();
    }, 0);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
    };
  }, [open, onClose, initialFocusRef]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 animate-fade-in sm:p-6"
      onClick={onClose}
    >
      <div
        ref={cardRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-bg-raised p-5 shadow-2xl outline-none animate-fade-in-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          {icon && (
            <div
              className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg border ${
                danger
                  ? "border-red-500/30 bg-red-500/10 text-red-300"
                  : "border-border bg-bg-card text-accent"
              }`}
            >
              {icon}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold text-fg">{title}</h2>
            {description && <div className="mt-1 text-sm text-fg-muted">{description}</div>}
          </div>
        </div>
        {children}
        {footer && <div className="flex justify-end gap-2 pt-1">{footer}</div>}
      </div>
    </div>
  );
}

/** Standard secondary (Cancel/Close) button used in modal footers. */
export function ModalButton({
  children,
  onClick,
  variant = "secondary",
  type = "button",
  disabled = false,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "secondary" | "primary" | "danger";
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  const styles =
    variant === "primary"
      ? "border-accent bg-accent-dim/40 text-fg hover:bg-accent-dim disabled:opacity-40 disabled:hover:bg-accent-dim/40"
      : variant === "danger"
      ? "border-red-500/50 bg-red-500/10 text-red-200 hover:bg-red-500/20 disabled:opacity-40"
      : "border-border text-fg-muted hover:border-border-strong hover:text-fg";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md border px-3.5 py-1.5 text-sm transition-colors disabled:cursor-not-allowed ${styles}`}
    >
      {children}
    </button>
  );
}
