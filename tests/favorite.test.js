/*
お気に入りAPI・並び順・永続化・失敗時と他操作との競合を検証する。
*/
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../src/app.js';
import { createJsonStore } from '../src/repositories/jsonStore.js';
import { createMessageRepository } from '../src/repositories/messageRepository.js';
import { createMessageService } from '../src/services/messageService.js';
import { demoState } from '../scripts/seedDemo.js';

async function setup(t, { io, providers = {} } = {}) {
  const dir = await fs.mkdtemp(join(tmpdir(), 'konekuto-favorite-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'store.json');
  const store = await createJsonStore(path, io ? { io } : {});
  await store.update(state => {
    Object.assign(state, demoState());
    state.contacts[1].lastMessageAt = '2026-10-17T02:00:00.000Z';
    state.conversations[1].updatedAt = state.contacts[1].lastMessageAt;
    state.messages[1].timestamp = state.contacts[1].lastMessageAt;
  });
  const server = createApp(store, { providers }).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (url, body, method = 'PATCH') => {
    const response = await fetch(`${base}${url}`, { method,
      ...(method === 'GET' ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  const patch = (id, body, suffix = '') => request(`/api/contacts/${id}/favorite${suffix}`, body);
  return { store, path, request, patch };
}

test('お気に入り登録・フィルタ・優先表示・履歴へ同じContactを返す', async t => {
  const { patch, request, store } = await setup(t);
  const before = store.read();
  assert.equal((await request('/api/contacts', undefined, 'GET')).body.data[0].contact.platform, 'slack');
  const result = await patch('demo-contact-line', { isFavorite: true });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { data: { ...before.contacts[0], isFavorite: true } });
  const inbox = (await request('/api/contacts', undefined, 'GET')).body.data;
  assert.equal(inbox[0].contact.id, 'demo-contact-line');
  const favorite = (await request('/api/contacts?filter=favorite', undefined, 'GET')).body.data;
  assert.deepEqual(favorite.map(item => item.contact.id), ['demo-contact-line']);
  const history = (await request('/api/contacts/demo-contact-line/messages', undefined, 'GET')).body.data;
  assert.equal(history.contact.isFavorite, true);
  const after = store.read();
  assert.deepEqual(after.messages, before.messages);
  assert.deepEqual(after.conversations, before.conversations);
  assert.deepEqual(after.reminders, before.reminders);
  assert.equal(after.contacts[0].lastMessageAt, before.contacts[0].lastMessageAt);
});

test('同じ値の再送でトグルせず、解除と再起動後の保持を確認', async t => {
  const { patch, request, store, path } = await setup(t);
  for (let i = 0; i < 2; i++) {
    assert.equal((await patch('demo-contact-slack', { isFavorite: true })).body.data.isFavorite, true);
  }
  assert.equal((await createJsonStore(path)).read().contacts[1].isFavorite, true);
  for (let i = 0; i < 2; i++) {
    assert.equal((await patch('demo-contact-slack', { isFavorite: false })).body.data.isFavorite, false);
  }
  assert.deepEqual((await request('/api/contacts?filter=favorite', undefined, 'GET')).body.data, []);
  assert.deepEqual((await createJsonStore(path)).read(), store.read());
});

test('不正入力・未知のクエリ・不在Contactを拒否し状態を保持する', async t => {
  const { patch, store } = await setup(t);
  const before = store.read();
  for (const body of [null, [], {}, { isFavorite: 'true' }, { isFavorite: 1 }, { isFavorite: null },
    { isFavorite: {} }, { isFavorite: true, platform: 'slack' }, { other: true }]) {
    const result = await patch('demo-contact-line', body);
    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'VALIDATION_ERROR');
  }
  assert.equal((await patch('demo-contact-line', { isFavorite: true }, '?extra=1')).status, 400);
  const missing = await patch('missing', { isFavorite: true });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, 'NOT_FOUND');
  assert.deepEqual(store.read(), before);
  assert.equal((await patch('demo-contact-line', { isFavorite: true })).status, 200);
});

test('保存失敗でディスク・メモリを更新せず、後続の操作で復旧できる', async t => {
  let fail = false;
  const { store, path, patch } = await setup(t, { io: { ...fs, rename: async (...args) => {
    if (fail) throw new Error('private-storage-details');
    return fs.rename(...args);
  } } });
  const before = store.read();
  const disk = await fs.readFile(path, 'utf8');
  fail = true;
  const result = await patch('demo-contact-line', { isFavorite: true });
  assert.equal(result.status, 500);
  assert.equal(result.body.error.code, 'STORAGE_ERROR');
  assert.ok(!JSON.stringify(result).includes('private-storage-details'));
  assert.deepEqual(store.read(), before);
  assert.equal(await fs.readFile(path, 'utf8'), disk);
  fail = false;
  assert.equal((await patch('demo-contact-line', { isFavorite: true })).status, 200);
  assert.equal((await createJsonStore(path)).read().contacts[0].isFavorite, true);
});

test('並行受信と別Contactの更新でお気に入りや新着を失わない', async t => {
  const { store, patch } = await setup(t);
  const messages = createMessageService(createMessageRepository(store));
  const results = await Promise.all([
    patch('demo-contact-line', { isFavorite: true }),
    patch('demo-contact-slack', { isFavorite: true }),
    messages.receive({ platform: 'line', platformUserId: 'demo-user-line', platformConversationId: 'demo-destination-line', displayName: '新しい表示名',
      message: { ...demoState().messages[0], platformMessageId: 'new-line', text: '新着', timestamp: '2026-10-17T03:00:00.000Z', metadata: {} } })
  ]);
  assert.equal(results[0].status, 200);
  assert.equal(results[1].status, 200);
  const state = store.read();
  assert.ok(state.contacts.every(contact => contact.isFavorite));
  assert.equal(state.contacts[0].displayName, '新しい表示名');
  assert.equal(state.messages.length, 3);
  assert.equal(state.conversations[0].hasUnreplied, true);
});

test('返信待ちの間の登録を送信履歴保存で上書きしない', async t => {
  let release; let entered;
  const gate = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { entered = resolve; });
  const { request, patch, store } = await setup(t, { providers: { line: { sendText: async ({ text }) => {
    entered(); await gate;
    return { platform: 'line', messageType: 'text', platformMessageId: 'sent-line', senderId: 'bot-line',
      text, timestamp: '2026-10-17T03:00:00.000Z', isFromMe: true, metadata: {} };
  } } } });
  const sending = request('/api/messages/reply', { conversationId: 'demo-conversation-line', text: '返信' }, 'POST');
  try {
    await ready;
    assert.equal((await patch('demo-contact-line', { isFavorite: true })).status, 200);
  } finally { release(); }
  assert.equal((await sending).status, 201);
  assert.equal(store.read().contacts[0].isFavorite, true);
  assert.equal(store.read().conversations[0].hasUnreplied, false);
});
