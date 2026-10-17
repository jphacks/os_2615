/*
API契約、永続化、更新競合、保存失敗と破損データ保護を検証する。
*/
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJsonStore } from '../src/repositories/jsonStore.js';
import { createApp } from '../src/app.js';
import { demoState } from '../scripts/seedDemo.js';

async function setup(t, options) {
  const dir = await fs.mkdtemp(join(tmpdir(), 'konekuto-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'store.json');
  const store = await createJsonStore(path, options);
  return { path, store };
}

async function serve(t, store) {
  const server = createApp(store).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return async path => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`);
    return { status: response.status, body: await response.json() };
  };
}

test('空ストアのhealth・Inbox・404が共通形式で返る', async t => {
  const { store } = await setup(t);
  const get = await serve(t, store);
  assert.deepEqual(await get('/api/health'), { status: 200, body: { data: { status: 'ok' } } });
  assert.deepEqual(await get('/api/contacts'), { status: 200, body: { data: [] } });
  for (const path of ['/api/contacts/missing/messages', '/api/missing']) {
    const result = await get(path);
    assert.equal(result.status, 404);
    assert.equal(result.body.error.code, 'NOT_FOUND');
  }
});

test('LINE・Slack一覧と全フィルタ、履歴順序、再起動後の保存を確認', async t => {
  const { store, path } = await setup(t);
  const seed = demoState();
  seed.contacts[1].isFavorite = true;
  seed.conversations[0].hasUnreplied = false;
  seed.messages.push({ ...seed.messages[0], id: 'older-message', platformMessageId: 'older',
    messageType: 'sticker', text: '[スタンプが送信されました]', metadata: {}, timestamp: '2026-10-16T00:00:00.000Z' });
  seed.reminders.push({ id: 'reminder', conversationId: seed.conversations[1].id,
    messageId: seed.messages[1].id, remindAt: '2026-10-17T02:00:00.000Z', status: 'pending' });
  await store.update(state => Object.assign(state, seed));
  const restarted = await createJsonStore(path);
  assert.deepEqual(restarted.read(), seed);
  const get = await serve(t, restarted);
  const all = (await get('/api/contacts')).body.data;
  assert.equal(all.length, 2);
  assert.equal(all[0].contact.platform, 'slack');
  assert.deepEqual(Object.keys(all[0]).sort(), ['contact', 'conversation', 'lastMessage', 'reminder']);
  assert.equal(all[1].reminder, null);
  for (const filter of ['unreplied', 'favorite', 'later']) {
    const result = await get(`/api/contacts?filter=${filter}`);
    assert.equal(result.status, 200);
    assert.equal(result.body.data.length, 1);
    assert.equal(result.body.data[0].contact.platform, 'slack');
  }
  const history = (await get('/api/contacts/demo-contact-line/messages')).body.data;
  assert.deepEqual(history.messages.map(message => message.id), ['older-message', 'demo-message-line']);
  assert.equal(history.messages[0].metadata.keywords, undefined);
  assert.equal(history.reminder, null);
  const slack = (await get('/api/contacts/demo-contact-slack/messages')).body.data;
  assert.match(slack.messages[0].text, /:smile:/);
});

test('不正filter・重複query・未知queryは400', async t => {
  const { store } = await setup(t);
  const get = await serve(t, store);
  for (const path of ['/api/contacts?filter=unknown', '/api/contacts?filter=all&filter=later',
    '/api/contacts?extra=1', '/api/contacts/demo/messages?extra=1']) {
    const result = await get(path);
    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'VALIDATION_ERROR');
  }
});

test('不正JSONとサイズ超過を共通形式で拒否する', async t => {
  const { store } = await setup(t);
  const server = createApp(store).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  for (const [body, expectedStatus, expectedCode] of [
    ['{"text":"private-input",', 400, 'VALIDATION_ERROR'],
    [JSON.stringify({ text: 'x'.repeat(66000) }), 413, 'PAYLOAD_TOO_LARGE']
  ]) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/contacts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body
    });
    const payload = await response.json();
    assert.equal(response.status, expectedStatus);
    assert.equal(payload.error.code, expectedCode);
    assert.ok(!JSON.stringify(payload).includes('private-input'));
  }
});

test('並列更新を失わず、readの変更が保存データに漏れない', async t => {
  const { store, path } = await setup(t);
  await store.update(state => Object.assign(state, demoState()));
  await Promise.all(Array.from({ length: 20 }, () => store.update(async state => {
    await new Promise(resolve => setImmediate(resolve));
    state.contacts[0].displayName += '!';
  })));
  assert.equal(store.read().contacts[0].displayName, '山田' + '!'.repeat(20));
  const snapshot = store.read();
  snapshot.contacts.length = 0;
  assert.equal(store.read().contacts.length, 2);
  assert.deepEqual((await createJsonStore(path)).read(), store.read());
});

test('保存失敗後もディスク・メモリを保持し、次回更新できる', async t => {
  let fail = false;
  const io = { ...fs, rename: async (...args) => {
    if (fail) throw new Error('private-provider-details');
    return fs.rename(...args);
  } };
  const { store, path } = await setup(t, { io });
  await store.update(state => Object.assign(state, demoState()));
  const before = await fs.readFile(path, 'utf8');
  fail = true;
  await assert.rejects(store.update(state => { state.contacts[0].isFavorite = true; }),
    error => error.code === 'STORAGE_ERROR' && !error.message.includes('private-provider-details'));
  assert.equal(store.read().contacts[0].isFavorite, false);
  assert.equal(await fs.readFile(path, 'utf8'), before);
  assert.deepEqual((await fs.readdir(join(path, '..'))).sort(), ['store.json']);
  fail = false;
  await store.update(state => { state.contacts[0].isFavorite = true; });
  assert.equal(store.read().contacts[0].isFavorite, true);
});

test('破損JSON・不正構造は空データで上書きしない', async t => {
  const { path } = await setup(t);
  for (const content of ['{broken', '{"version":1}', JSON.stringify({ ...demoState(), conversations: [] })]) {
    await fs.writeFile(path, content);
    await assert.rejects(createJsonStore(path), error => error.code === 'STORAGE_ERROR');
    assert.equal(await fs.readFile(path, 'utf8'), content);
  }
});

test('想定外の内部エラー内容をAPIに露出せずサーバーを維持', async t => {
  let broken = true;
  const store = { read() { if (broken) throw new Error('private-error-text'); return demoState(); } };
  const get = await serve(t, store);
  const result = await get('/api/contacts');
  assert.equal(result.status, 500);
  assert.equal(result.body.error.code, 'INTERNAL_ERROR');
  assert.ok(!JSON.stringify(result.body).includes('private-error-text'));
  broken = false;
  assert.equal((await get('/api/contacts')).status, 200);
});
