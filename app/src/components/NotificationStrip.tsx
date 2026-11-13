import type { Toast } from './shared';

export function NotificationStrip({ items }: { items: Toast[] }) {
  if (!items.length) return null;
  return (
    <div className="notification-strip" aria-live="polite">
      {items.slice(-3).map((item) => (
        <span className={`notice notice-${item.kind}`} key={item.id}>
          {item.text}
          {item.text.includes('ASSEMBLY') && <a href="#/agora">GO TO AGORA →</a>}
        </span>
      ))}
    </div>
  );
}
