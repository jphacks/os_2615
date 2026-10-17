/*
後で返信の日時・入力を検証し、共通Reminderを返す。
*/
import { invalidInput } from '../utils/errors.js';

function exactKeys(input, keys) {
  return input && typeof input === 'object' && !Array.isArray(input) &&
    Object.keys(input).length === keys.length && keys.every(key => Object.hasOwn(input, key));
}

function normalizeDate(value) {
  if (typeof value !== 'string') throw invalidInput();
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) throw invalidInput();
  const [, y, m, d, h, min, s, zone] = match;
  const year = Number(y), month = Number(m), day = Number(d);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] ||
      Number(h) > 23 || Number(min) > 59 || Number(s) > 59 ||
      (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59))) throw invalidInput();
  const time = Date.parse(value);
  if (!Number.isFinite(time) || time <= Date.now()) throw invalidInput();
  return new Date(time).toISOString();
}

export function createReminderService(repository) {
  return {
    list(status = 'pending') {
      if (!['pending', 'done', 'cancelled', 'all'].includes(status)) throw invalidInput();
      return repository.list().filter(item => status === 'all' || item.status === status)
        .sort((a, b) => Date.parse(a.remindAt) - Date.parse(b.remindAt) || a.id.localeCompare(b.id));
    },
    save(input) {
      if (!exactKeys(input, ['conversationId', 'messageId', 'remindAt']) ||
          ![input.conversationId, input.messageId].every(value => typeof value === 'string' && value.trim())) throw invalidInput();
      return repository.save({ conversationId: input.conversationId, messageId: input.messageId,
        remindAt: normalizeDate(input.remindAt) });
    },
    cancel(id, input) {
      if (!exactKeys(input, ['status']) || input.status !== 'cancelled') throw invalidInput();
      return repository.cancel(id);
    }
  };
}
