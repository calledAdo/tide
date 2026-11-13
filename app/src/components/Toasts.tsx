import { useEffect, useRef } from 'react';
import type { Toast } from './shared';

type ToastsProps = {
  toasts: Toast[];
  onDismiss: (id: number) => void;
};

export function Toasts({ toasts, onDismiss }: ToastsProps) {
  const timers = useRef(new Map<number, number>());
  useEffect(() => {
    const active = new Set(toasts
      .filter((toast) => toast.kind === 'success' || toast.kind === 'info')
      .map((toast) => toast.id));
    toasts.forEach((toast) => {
      if (active.has(toast.id) && !timers.current.has(toast.id)) {
        const timer = window.setTimeout(() => {
          timers.current.delete(toast.id);
          onDismiss(toast.id);
        }, 6_000);
        timers.current.set(toast.id, timer);
      }
    });
    timers.current.forEach((timer, id) => {
      if (!active.has(id)) {
        window.clearTimeout(timer);
        timers.current.delete(id);
      }
    });
    return () => undefined;
  }, [toasts, onDismiss]);
  useEffect(() => () => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
  }, []);
  if (!toasts.length) return null;
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.slice(-3).map((toast) => (
        <div className={`toast ${toast.kind}`} key={toast.id}>
          <span>{toast.text}</span>
          {toast.retry && (
            <button onClick={() => {
              onDismiss(toast.id);
              toast.retry?.();
            }}>
              REGISTER &amp; RETRY
            </button>
          )}
          {toast.result?.hash && (
            <a href={toast.result.url} target="_blank" rel="noreferrer">VIEW ↗</a>
          )}
          <button aria-label="Dismiss toast" onClick={() => onDismiss(toast.id)}>×</button>
        </div>
      ))}
    </div>
  );
}
