import test from "node:test";
import assert from "node:assert/strict";
import {
  dueReminderAlerts,
  reminderAlertKey,
} from "../src/components/reminderAlerts.js";
const item = (id, remindAt, status = "pending") => ({
  contact: { id },
  reminder: { id, remindAt, status },
});
const now = Date.parse("2026-10-17T06:00:00Z");
test("only pending reminders appear at or after deadline, oldest first", () => {
  const items = [
    item("future", "2026-10-17T06:00:01Z"),
    item("due", "2026-10-17T06:00:00Z"),
    item("old", "2026-10-17T05:00:00Z"),
    item("done", "2026-10-17T05:00:00Z", "done"),
    item("cancelled", "2026-10-17T05:00:00Z", "cancelled"),
    { reminder: null },
  ];
  assert.deepEqual(
    dueReminderAlerts(items, now).map((i) => i.contact.id),
    ["old", "due"],
  );
  assert.deepEqual(
    dueReminderAlerts([items[0]], now + 1000).map((i) => i.contact.id),
    ["future"],
  );
});
test("dismissed notices stay hidden on polling, rescheduling can notify again", () => {
  const original = item("same", "2026-10-17T05:00:00Z");
  const dismissed = new Set([reminderAlertKey(original.reminder)]);
  assert.equal(
    dueReminderAlerts([structuredClone(original)], now, dismissed).length,
    0,
  );
  assert.equal(
    dueReminderAlerts([item("same", "2026-10-17T05:30:00Z")], now, dismissed)
      .length,
    1,
  );
});
