// Toast stack — bottom-right transient notifications.
//
// Mounted once at the Shell level. Reads from toastStore and renders a fixed
// stack that slides + fades in/out. Themed via tokens, reduced-motion aware,
// and announced to assistive tech via role="status" / aria-live="polite".

import type { ToastKind } from "../store/toastStore";
import { useToastStore } from "../store/toastStore";
import "../styles/toast.css";

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3.5 8.5l3 3 6-7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M8 5v3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="8" cy="11" r="0.85" fill="currentColor" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M8 7.25v4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="8" cy="4.75" r="0.85" fill="currentColor" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="M3 3l6 6M9 3l-6 6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function iconFor(kind: ToastKind) {
  if (kind === "success") return <CheckIcon />;
  if (kind === "error") return <ErrorIcon />;
  return <InfoIcon />;
}

export function Toast() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-stack" role="status" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => {
        const clickable = typeof t.onClick === "function";
        return (
          <div
            key={t.id}
            className={`toast toast--${t.kind}${clickable ? " toast--clickable" : ""}`}
          >
            {/* The body is a button only when it has an action, so the whole
                toast is one click target without nesting interactive elements. */}
            {clickable ? (
              <button
                type="button"
                className="toast__body toast__body--action"
                onClick={() => {
                  t.onClick?.();
                  dismiss(t.id);
                }}
              >
                <span className="toast__icon">{iconFor(t.kind)}</span>
                <span className="toast__message">{t.message}</span>
              </button>
            ) : (
              <div className="toast__body">
                <span className="toast__icon">{iconFor(t.kind)}</span>
                <span className="toast__message">{t.message}</span>
              </div>
            )}
            <button
              type="button"
              className="toast__close"
              aria-label="Dismiss notification"
              onClick={() => dismiss(t.id)}
            >
              <CloseIcon />
            </button>
          </div>
        );
      })}
    </div>
  );
}
