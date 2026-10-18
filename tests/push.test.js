import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createECDH } from 'node:crypto';
import express from 'express';
import webpush from 'web-push';
import { createPushService, validateSubscription } from '../src/services/pushService.js';
import { createPushRouter } from '../src/routes/push.js';
import { createStateIndex } from '../src/repositories/stateIndex.js';
import { demoState } from './fixtures/demoState.js';
function subscription(id = 'one') {
  const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
  return { endpoint: `https://web.push.apple.com/${id}`, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
}
async function setup(t, send) {
  const dir = await fs.mkdtemp(join(tmpdir(), 'konekuto-push-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const state = demoState();
  let clock = Date.parse('2026-10-18T01:00:00Z');
  const store = { readIndexed: fn => structuredClone(fn(state, createStateIndex(state))) };
  const path = join(dir, 'push.json');
  const service = await createPushService(store, path, { send, now: () => clock });
  return { service, path, store, state, advance: ms => { clock += ms; } };
}
function incoming(state, id) {
  state.messages.push({ ...state.messages[0], id, timestamp: '2026-10-18T01:00:00Z' });
}
test('購読先は公的Push事業者のHTTPSと有効な鍵に制限', () => {
  const sub = subscription();
  assert.deepEqual(validateSubscription(sub), sub);
  for (const endpoint of ['http://web.push.apple.com/a', 'https://127.0.0.1/a', 'https://web.push.apple.com.evil.test/a', 'https://web.push.apple.com:8443/a', 'https://user@web.push.apple.com/a']) {
    assert.throws(() => validateSubscription({ ...sub, endpoint }));
  }
  assert.throws(() => validateSubscription({ ...sub, keys: { p256dh: 'bad', auth: 'bad' } }));
});
test('登録前は通知せず、新着・期限到来を一度だけ通知、本文を含めない', async t => {
  const sent = [];
  const { service, state, advance } = await setup(t, async (sub, payload, options) => sent.push({ sub, payload: JSON.parse(payload), options }));
  const sub = subscription();
  await service.subscribe(sub);
  await service.tick(); assert.equal(sent.length, 0);
  incoming(state, 'new');
  await service.tick(); await service.tick();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.body, '新しいメッセージが届きました。');
  assert.ok(!JSON.stringify(sent[0].payload).includes('山田'));
  // 本物のweb-pushで暗号化要求まで生成できることを確認。外部送信しない。
  const request = webpush.generateRequestDetails(sub, JSON.stringify(sent[0].payload), sent[0].options);
  assert.equal(request.endpoint, sub.endpoint);
  state.reminders.push({ id: 'r', conversationId: state.conversations[0].id, status: 'pending', remindAt: '2026-10-18T01:01:00Z' });
  await service.tick(); assert.equal(sent.length, 1);
  advance(60000);
  await service.tick(); await service.tick();
  assert.equal(sent.length, 2); assert.match(sent[1].payload.title, /返信/);
  await service.unsubscribe(sub); incoming(state, 'after-stop'); await service.tick();
  assert.equal(sent.length, 2);
});
test('再起動してもVAPID鍵・購読・配信済み記録を保持', async t => {
  const sent = [];
  const send = async (...args) => sent.push(args);
  const { service, state, store, path } = await setup(t, send);
  await service.subscribe(subscription()); incoming(state, 'new'); await service.tick();
  const restarted = await createPushService(store, path, { send, now: () => Date.parse('2026-10-18T01:00:00Z') });
  assert.equal(restarted.publicKey, service.publicKey);
  await restarted.tick(); assert.equal(sent.length, 1);
  assert.equal((await fs.stat(path)).mode & 0o777, 0o600);
});
test('一時的な配信失敗は再試行、410の端末は削除', async t => {
  let calls = 0;
  const { service, state } = await setup(t, async () => { calls++; if (calls === 1) throw { statusCode: 503 }; if (calls === 3) throw { statusCode: 410 }; });
  await service.subscribe(subscription()); incoming(state, 'new');
  await service.tick(); await service.tick(); await service.tick(); assert.equal(calls, 2);
  incoming(state, 'next'); await service.tick(); incoming(state, 'last'); await service.tick(); assert.equal(calls, 3);
});
test('テスト通知のAPI・購読解除とクロスサイト拒否', async t => {
  let calls = 0;
  const { service } = await setup(t, async () => { calls++; });
  const app = express(); app.use(express.json()); app.use('/push', createPushRouter(service));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ code: error.code }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}/push/`;
  const sub = subscription();
  const post = (path, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(sub) });
  const config = await (await fetch(base + 'config')).json(); assert.equal(config.data.publicKey, service.publicKey);
  assert.equal((await post('subscribe', { 'Sec-Fetch-Site': 'cross-site' })).status, 400);
  assert.equal((await post('subscribe')).status, 200);
  assert.equal((await post('test')).status, 200); assert.equal(calls, 1);
  assert.equal((await post('test')).status, 429);
  assert.equal((await post('unsubscribe')).status, 200);
});

test('Service Workerは通知を表示し、クリックで同じサイトを開く', async () => {
  const { runInNewContext } = await import('node:vm');
  const handlers = {}, shown = [], opened = [];
  const source = await fs.readFile(new URL('../frontend/public/push-sw.js', import.meta.url), 'utf8');
  runInNewContext(source, { URL, self: {
    addEventListener: (name, handler) => { handlers[name] = handler; },
    location: { origin: 'https://konekuto.example' },
    registration: { showNotification: async (...args) => shown.push(args) },
    clients: { matchAll: async () => [], openWindow: async url => opened.push(url) }
  } });
  let pending;
  handlers.push({ data: { json: () => ({ title: 'こねくと', body: '通知', url: 'https://evil.example' }) }, waitUntil: promise => { pending = promise; } });
  await pending;
  assert.equal(shown[0][0], 'こねくと'); assert.equal(shown[0][1].body, '通知');
  let closed = false;
  handlers.notificationclick({ notification: { close: () => { closed = true; } }, waitUntil: promise => { pending = promise; } });
  await pending;
  assert.equal(closed, true); assert.deepEqual(opened, ['/']);
});
