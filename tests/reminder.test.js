/*
リマインダーAPIの永続化・入力検証・返信との状態遷移を検証する。
*/
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../src/app.js';
import { createJsonStore } from '../src/repositories/jsonStore.js';
import { demoState } from './fixtures/demoState.js';

const input = () => ({ conversationId: 'demo-conversation-line', messageId: 'demo-message-line',
  remindAt: new Date(Date.now() + 3600000).toISOString() });
async function setup(t, io) {
  const dir = await fs.mkdtemp(join(tmpdir(), 'konekuto-reminder-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'store.json');
  const store = await createJsonStore(path, io ? { io } : {});
  await store.update(state => Object.assign(state, demoState()));
  const providers = { line: { sendText: async ({ text }) => ({ platform: 'line', messageType: 'text',
    platformMessageId: 'sent', senderId: 'bot', text, timestamp: new Date().toISOString(), isFromMe: true, metadata: {} }) } };
  const server = createApp(store, { providers }).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const request = async (url, body, method = body === undefined ? 'GET' : 'POST') => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api${url}`, { method,
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    return { status: res.status, body: await res.json() };
  };
  return { request, store, path };
}

test('作成・更新・Inbox連携・再起動後の保持・取消', async t => {
  const { request, store, path } = await setup(t);
  const first = await request('/reminders', { ...input(), remindAt: '2099-10-17T15:00:00+09:00' });
  assert.equal(first.status, 201);
  assert.equal(first.body.data.remindAt, '2099-10-17T06:00:00.000Z');
  const id = first.body.data.id;
  const updated = await request('/reminders', input());
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.id, id);
  assert.equal(store.read().reminders.length, 1);
  assert.deepEqual((await createJsonStore(path)).read(), store.read());
  assert.equal((await request('/contacts?filter=later')).body.data[0].reminder.id, id);
  assert.equal((await request('/contacts/demo-contact-line/messages')).body.data.reminder.id, id);
  for (let i = 0; i < 2; i++) assert.equal((await request(`/reminders/${id}`, { status: 'cancelled' }, 'PATCH')).status, 200);
  assert.deepEqual((await request('/reminders')).body.data, []);
  assert.deepEqual((await request('/contacts?filter=later')).body.data, []);
  assert.equal((await request('/reminders?status=cancelled')).body.data.length, 1);
  assert.equal((await request('/reminders', input())).status, 201);
});

test('不正日時・入力・クエリ・別会話のMessageを拒否する', async t => {
  const { request, store } = await setup(t);
  const before = store.read();
  for (const remindAt of ['2020-01-01T00:00:00Z', '2099-02-29T00:00:00Z', '2099-04-31T00:00:00Z',
    '2099-10-17T15:00:00', '2099-10-17T24:00:00Z', '2099-10-17T15:00:00+09:60', null]) {
    assert.equal((await request('/reminders', { ...input(), remindAt })).status, 400);
  }
  for (const body of [null, [], {}, { ...input(), status: 'pending' }, { ...input(), messageId: 1 }]) {
    assert.equal((await request('/reminders', body)).status, 400);
  }
  assert.equal((await request('/reminders', { ...input(), messageId: 'missing' })).status, 404);
  assert.equal((await request('/reminders', { ...input(), conversationId: 'missing' })).status, 404);
  assert.equal((await request('/reminders', { ...input(), messageId: 'demo-message-slack' })).status, 400);
  for (const query of ['?extra=1', '?status=invalid', '?status=pending&status=done']) {
    assert.equal((await request(`/reminders${query}`)).status, 400);
  }
  assert.equal((await request('/reminders?extra=1', input())).status, 400);
  assert.equal((await request('/reminders/missing', { status: 'cancelled' }, 'PATCH')).status, 404);
  assert.deepEqual(store.read(), before);
});

test('並行設定でもpendingは1件、期限超過でも一覧に残り、返信でdoneになる', async t => {
  const { request, store } = await setup(t);
  const results = await Promise.all([request('/reminders', input()), request('/reminders', input())]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 201]);
  assert.equal(store.read().reminders.length, 1);
  const id = results[0].body.data.id;
  await store.update(state => { state.reminders[0].remindAt = '2020-01-01T00:00:00.000Z'; });
  assert.equal((await request('/reminders')).body.data.length, 1);
  assert.equal((await request('/contacts?filter=later')).body.data.length, 1);
  assert.equal((await request('/messages/reply', { conversationId: input().conversationId, text: '返信' })).status, 201);
  assert.deepEqual((await request('/reminders')).body.data, []);
  assert.equal((await request('/reminders?status=done')).body.data[0].id, id);
  assert.equal((await request(`/reminders/${id}`, { status: 'cancelled' }, 'PATCH')).status, 409);
  assert.equal((await request(`/reminders/${id}`, { status: 'done' }, 'PATCH')).status, 400);
});

test('保存失敗で状態を保持し、後続の設定で復旧する', async t => {
  let fail = false;
  const { request, store, path } = await setup(t, { ...fs, rename: async (...args) => {
    if (fail) throw new Error('private-storage-details');
    return fs.rename(...args);
  } });
  const before = store.read();
  fail = true;
  const result = await request('/reminders', input());
  assert.equal(result.status, 500);
  assert.equal(result.body.error.code, 'STORAGE_ERROR');
  assert.ok(!JSON.stringify(result).includes('private-storage-details'));
  assert.deepEqual(store.read(), before);
  assert.deepEqual((await createJsonStore(path)).read(), before);
  fail = false;
  assert.equal((await request('/reminders', input())).status, 201);
});
