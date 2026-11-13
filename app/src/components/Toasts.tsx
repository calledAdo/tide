import type { Toast } from './shared';

type ToastsProps = {
  toasts: Toast[];
  onDismiss: (id: number) => void;
};

export function Toasts({ toasts, onDismiss }: ToastsProps) {
  if (!toasts.length) return null;
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.slice(-4).map((toast) => (
        <div className={`toast ${toast.kind}`} key={toast.id}>
          <span>{toast.text}</span>
          {toast.result?.hash && (
            <a href={toast.result.url} target="_blank" rel="noreferrer">VIEW ↗</a>
          )}
          <button aria-label="Dismiss toast" onClick={() => onDismiss(toast.id)}>×</button>
        </div>
      ))}
    </div>
  );
}
