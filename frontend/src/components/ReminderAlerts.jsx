import React, { useState } from "react";
import { BellRing, ArrowRight, X } from "lucide-react";
import { dueReminderAlerts, reminderAlertKey } from "./reminderAlerts.js";
export default function ReminderAlerts({ items, now, onOpen }) {
  const [dismissed, setDismissed] = useState(() => new Set());
  const due = dueReminderAlerts(items, now, dismissed);
  const dismiss = (reminder) =>
    setDismissed(
      (previous) => new Set([...previous, reminderAlertKey(reminder)]),
    );
  if (!due.length) return null;
  return (
    <aside className="reminder-alert-stack" aria-label="返信リマインダー通知">
      {due.slice(0, 3).map(({ contact, reminder }) => (
        <section
          className="reminder-alert"
          key={reminderAlertKey(reminder)}
          role="alert"
        >
          <button
            className="reminder-alert-close"
            aria-label={`${contact.displayName}さんの通知を閉じる`}
            onClick={() => dismiss(reminder)}
          >
            <X size={19} />
          </button>
          <div className="reminder-alert-label">
            <BellRing size={20} />
            <span>返信リマインダー</span>
            <span className="reminder-alert-time">
              {new Date(reminder.remindAt).toLocaleTimeString("ja-JP", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
          <h2>返信の時間です！</h2>
          <p>
            <strong>{contact.displayName}</strong>さんが待っています。
          </p>
          <button
            className="reminder-alert-open"
            onClick={() => {
              onOpen(contact.id);
              dismiss(reminder);
            }}
          >
            会話を開いて返信する
            <ArrowRight size={17} />
          </button>
          <span className="reminder-alert-note">
            閉じても「後で返信」から確認できます
          </span>
        </section>
      ))}
      {due.length > 3 && (
        <div className="reminder-alert-more">
          ほか {due.length - 3} 件のリマインダーがあります
        </div>
      )}
    </aside>
  );
}
