export const reminderAlertKey = (reminder) =>
  `${reminder.id}:${reminder.remindAt}`;
export function dueReminderAlerts(items, now, dismissed = new Set()) {
  return items
    .filter(
      ({ reminder }) =>
        reminder?.status === "pending" &&
        Date.parse(reminder.remindAt) <= now &&
        !dismissed.has(reminderAlertKey(reminder)),
    )
    .sort(
      (a, b) =>
        Date.parse(a.reminder.remindAt) - Date.parse(b.reminder.remindAt) ||
        a.reminder.id.localeCompare(b.reminder.id),
    );
}
