import test from 'node:test';
import assert from 'node:assert/strict';
import { createContactService } from '../src/services/contactService.js';

function item(id, { deadline, status = 'pending', favorite = false, updated = '2026-10-18T10:00:00Z', unreplied = true } = {}) {
  return {
    contact: { id, isFavorite: favorite, lastMessageAt: updated },
    conversation: { hasUnreplied: unreplied },
    reminder: deadline === undefined ? null : { status, remindAt: deadline },
  };
}
const ids = items => items.map(row => row.contact.id);
const service = items => createContactService({ listInbox: () => items });

test('後で返信は期限超過・近日・遠い期限・期限未設定の順で、お気に入りより期限を優先する', () => {
  const items = [
    item('no-deadline', { favorite: true }),
    item('tomorrow', { deadline: '2026-10-19T09:00:00+09:00', favorite: true }),
    item('overdue', { deadline: '2026-10-17T09:00:00+09:00' }),
    item('today', { deadline: '2026-10-18T10:00:00+09:00' }),
    item('older-overdue', { deadline: '2026-10-16T09:00:00+09:00' }),
  ];
  const before = structuredClone(items);
  assert.deepEqual(ids(service(items).list()), ['older-overdue', 'overdue', 'today', 'tomorrow', 'no-deadline']);
  assert.deepEqual(items, before, '並び替えで保存元の配列や内容を変更しない');
});

test('同一期限と期限未設定同士はお気に入り・新着・IDの従来順を保ち、時差表記を正しく比較する', () => {
  const items = [
    item('z', { deadline: '2026-10-18T03:00:00Z' }),
    item('a', { deadline: '2026-10-18T12:00:00+09:00' }),
    item('recent', { deadline: '2026-10-18T03:00:00Z', updated: '2026-10-18T11:00:00Z' }),
    item('favorite', { deadline: '2026-10-18T03:00:00Z', favorite: true }),
    item('plain-old', { updated: '2026-10-18T09:00:00Z' }),
    item('plain-new'),
    item('plain-favorite', { favorite: true }),
  ];
  assert.deepEqual(ids(service(items).list()), ['favorite', 'recent', 'a', 'z', 'plain-favorite', 'plain-new', 'plain-old']);
});

test('完了・取消・不正日時は優先せず、期限の変更と取消が次回取得に反映される', () => {
  const items = [
    item('cancelled', { deadline: '2026-10-01T00:00:00Z', status: 'cancelled' }),
    item('done', { deadline: '2026-10-01T00:00:00Z', status: 'done' }),
    item('invalid', { deadline: 'invalid' }),
    item('first', { deadline: '2026-10-18T01:00:00Z' }),
    item('second', { deadline: '2026-10-18T02:00:00Z' }),
  ];
  const inbox = service(items);
  assert.deepEqual(ids(inbox.list()), ['first', 'second', 'cancelled', 'done', 'invalid']);
  items[4].reminder.remindAt = '2026-10-18T00:00:00Z';
  assert.deepEqual(ids(inbox.list()).slice(0, 2), ['second', 'first']);
  items[4].reminder = null;
  assert.equal(inbox.list()[0].contact.id, 'first');
  items[3].reminder = null;
  assert.deepEqual(ids(inbox.list()), ['cancelled', 'done', 'first', 'invalid', 'second']);
});

test('未返信・お気に入り・後で返信の各フィルタでも対象を保って期限順に並ぶ', () => {
  const inbox = service([
    item('late', { deadline: '2026-10-19T00:00:00Z', favorite: true }),
    item('no-deadline'),
    item('early', { deadline: '2026-10-18T00:00:00Z', favorite: true }),
    item('replied', { deadline: '2026-10-17T00:00:00Z', unreplied: false }),
  ]);
  assert.deepEqual(ids(inbox.list('unreplied')), ['early', 'late', 'no-deadline']);
  assert.deepEqual(ids(inbox.list('favorite')), ['early', 'late']);
  assert.deepEqual(ids(inbox.list('later')), ['replied', 'early', 'late']);
});
