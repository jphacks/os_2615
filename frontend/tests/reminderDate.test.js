import test from "node:test";
import assert from "node:assert/strict";
import {
  monthDays,
  localDateTime,
  withDay,
} from "../src/components/reminderDate.js";
test("calendar aligns weekdays, leap days and month boundaries", () => {
  const feb = monthDays(2028, 1);
  assert.equal(feb.filter(Boolean).length, 29);
  assert.equal(feb.indexOf("2028-02-01"), new Date(2028, 1, 1).getDay());
  assert.equal(feb.length % 7, 0);
  assert.equal(monthDays(2027, 1).filter(Boolean).length, 28);
  assert.ok(monthDays(2026, 11).includes("2026-12-31"));
});
test("day selection preserves local time across months and years", () => {
  assert.equal(withDay("2026-12-31T13:07", "2027-01-01"), "2027-01-01T13:07");
});
test("quick selection uses local wall clock without UTC shifting", () => {
  assert.equal(localDateTime(new Date(2026, 9, 17, 13, 7)), "2026-10-17T13:07");
});
