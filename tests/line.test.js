/*
LINE受信の署名、変換、重複排除、永続化、失敗時の復旧を検証する。実APIには接続しない。
*/
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { createApp, createWebhookApp } from '../src/app.js';
import { createJsonStore } from '../src/repositories/jsonStore.js';
import { createLineClient } from '../src/providers/line/lineClient.js';
import { mapLineEvent } from '../src/providers/line/lineMapper.js';
import { demoState } from './fixtures/demoState.js';

const channelSecret = 'test-only-channel-secret';
function event(id = 'message-1', overrides = {}) {
  return { type: 'message', webhookEventId: `event-${id}`, timestamp: 1792198800000,
    source: { type: 'user', userId: 'U_TEST_USER' }, replyToken: 'test-only-reply-token',
    message: { type: 'text', id, text: '明日の集合時間どうする？' }, ...overrides };
}
const sign = body => createHmac('sha256', channelSecret).update(body).digest('base64');

async function listen(t, app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}

async function setup(t, options = {}, storeOptions) {
  const dir = await fs.mkdtemp(join(tmpdir(), 'konekuto-line-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'store.json');
  const store = await createJsonStore(path, storeOptions);
  const webhook = await listen(t, createWebhookApp(store, { channelSecret, getDisplayName: async () => '山田', ...options }));
  const api = await listen(t, createApp(store));
  const post = async (events, { body = JSON.stringify({ events }), signature = sign(body), headers = {} } = {}) => {
    const response = await fetch(`${webhook}/webhooks/line`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-line-signature': signature, ...headers }, body });
    return { status: response.status, body: await response.json() };
  };
  return { store, path, post, webhook, api };
}

test('署名付きtextを共通形式で保存し、同じInboxと履歴に表示する', async t => {
  const { post, store, api } = await setup(t);
  await store.update(state => Object.assign(state, demoState()));
  const body = JSON.stringify({ events: [event()] }, null, 2) + '\n';
  assert.deepEqual(await post([], { body }), { status: 200, body: { ok: true } });
  const inbox = await (await fetch(`${api}/api/contacts`)).json();
  assert.equal(inbox.data.length, 3);
  const item = inbox.data.find(item => item.contact.platformUserId === 'U_TEST_USER');
  assert.equal(item.contact.displayName, '山田');
  assert.equal(item.contact.platform, 'line');
  assert.equal(item.conversation.hasUnreplied, true);
  assert.equal(item.conversation.platformConversationId, 'U_TEST_USER');
  assert.equal(item.lastMessage.platformMessageId, 'message-1');
  assert.equal(item.lastMessage.text, '明日の集合時間どうする？');
  assert.equal(item.lastMessage.isFromMe, false);
  assert.equal(item.reminder, null);
  const history = await (await fetch(`${api}/api/contacts/${item.contact.id}/messages`)).json();
  assert.equal(history.data.messages.length, 1);
  assert.equal(history.data.messages[0].conversationId, item.conversation.id);
  assert.ok(!JSON.stringify(history).includes('test-only-reply-token'));
  assert.ok(!JSON.stringify(store.read()).includes('test-only-reply-token'));
});

test('署名不正・欠落・body改変はJSON解析前に401で拒否する', async t => {
  let profiles = 0;
  const { post, store, webhook } = await setup(t, { getDisplayName: async () => { profiles++; return '山田'; } });
  const body = '{invalid-json';
  assert.equal((await post([], { body, signature: 'invalid' })).status, 401);
  const validBody = JSON.stringify({ events: [event()] });
  assert.equal((await post([], { body: validBody + ' ', signature: sign(validBody) })).status, 401);
  const response = await fetch(`${webhook}/webhooks/line`, { method: 'POST', body: validBody });
  assert.equal(response.status, 401);
  assert.equal(profiles, 0);
  assert.equal(store.read().messages.length, 0);
});

test('正しい署名でも不正JSON・不正イベントは400、部分保存しない', async t => {
  const { post, store } = await setup(t);
  for (const body of ['{broken', '{}', 'null', '{"events":{}}']) {
    assert.equal((await post([], { body })).status, 400);
  }
  const invalid = event('bad', { timestamp: null });
  assert.equal((await post([event(), invalid])).status, 400);
  assert.equal(store.read().messages.length, 0);
});

test('Channel Secret未設定は503、確認用の空eventsは200', async t => {
  const absent = await setup(t, { channelSecret: '' });
  assert.equal((await absent.post([])).status, 503);
  const configured = await setup(t);
  assert.deepEqual(await configured.post([]), { status: 200, body: { ok: true } });
});

test('スタンプのkeywords有無と未対応typeを安全な表示へ変換する', async t => {
  const { post, store } = await setup(t);
  const sticker = (id, extra = {}) => event(id, { message: { type: 'sticker', id,
    packageId: 'package', stickerId: 'sticker', stickerResourceType: 'STATIC', ...extra } });
  assert.equal((await post([sticker('s1', { keywords: ['happy', 'smile'] }), sticker('s2'),
    sticker('s3', { keywords: 'not-an-array' }),
    event('image1', { message: { type: 'image', id: 'image1' } })])).status, 200);
  const messages = store.read().messages;
  assert.deepEqual(messages[0].metadata.keywords, ['happy', 'smile']);
  assert.equal(messages[0].text, '[スタンプが送信されました]');
  assert.equal(messages[0].metadata.packageId, 'package');
  assert.deepEqual(messages[1].metadata.keywords, []);
  assert.deepEqual(messages[2].metadata.keywords, []);
  assert.equal(messages[3].messageType, 'other');
  assert.equal(messages[3].text, '[未対応のメッセージ]');
});

test('グループ・room・対象外イベントを無視する', async t => {
  let profiles = 0;
  const { post, store } = await setup(t, { getDisplayName: async () => { profiles++; } });
  assert.equal((await post([event('g', { source: { type: 'group', userId: 'user', groupId: 'group' } }),
    event('r', { source: { type: 'room', userId: 'user' } }), { type: 'follow' }, null])).status, 200);
  assert.equal(store.read().contacts.length, 0);
  assert.equal(profiles, 0);
});

test('再配信・並行受信・再起動後の再配信を重複保存しない', async t => {
  const { post, store, path } = await setup(t);
  const results = await Promise.all(Array.from({ length: 5 }, () => post([event()])));
  assert.ok(results.every(result => result.status === 200));
  assert.equal((await post([event('message-1', { webhookEventId: 'different-event' })])).status, 200);
  assert.equal((await post([event('different-message', { webhookEventId: 'event-message-1' })])).status, 200);
  assert.equal(store.read().messages.length, 1);
  assert.equal(store.read().contacts.length, 1);
  assert.equal(store.read().conversations.length, 1);
  const restarted = await createJsonStore(path);
  const url = await listen(t, createWebhookApp(restarted, { channelSecret,
    getDisplayName: async () => { throw new Error('Should not need profile for duplicate'); } }));
  const body = JSON.stringify({ events: [event()] });
  assert.equal((await fetch(`${url}/webhooks/line`, { method: 'POST', body,
    headers: { 'x-line-signature': sign(body) } })).status, 200);
  assert.equal(restarted.read().messages.length, 1);
});

test('プロフィール失敗でも受信し、既存表示名を代替名で上書きしない', async t => {
  let fail = true;
  const { post, store } = await setup(t, { getDisplayName: async () => {
    if (fail) throw new Error('private-token-and-error');
    return '山田';
  } });
  assert.equal((await post([event()])).status, 200);
  assert.match(store.read().contacts[0].displayName, /^LINEユーザー/);
  fail = false;
  await post([event('next')]);
  assert.equal(store.read().contacts[0].displayName, '山田');
  fail = true;
  await post([event('third')]);
  assert.equal(store.read().contacts[0].displayName, '山田');
  assert.equal(store.read().messages[2].senderName, '山田');
  assert.ok(!JSON.stringify(store.read()).includes('private-token-and-error'));
});

test('時刻順が逆の受信で最新表示・返信済み状態を巻き戻さない', async t => {
  const { post, store } = await setup(t);
  await post([event('newer', { timestamp: 2000 })]);
  await post([event('older', { timestamp: 1000 })]);
  assert.equal(store.read().contacts[0].lastMessageAt, new Date(2000).toISOString());
  assert.equal(store.read().messages.find(item => item.id === store.read().conversations[0].lastMessageId).platformMessageId, 'newer');
  await store.update(state => {
    const outgoing = { ...state.messages[0], id: 'outgoing', platformMessageId: 'outgoing',
      senderName: '自分', isFromMe: true, timestamp: new Date(4000).toISOString(), metadata: {} };
    state.messages.push(outgoing);
    Object.assign(state.conversations[0], { hasUnreplied: false, lastMessageId: outgoing.id, updatedAt: outgoing.timestamp });
    state.contacts[0].lastMessageAt = outgoing.timestamp;
  });
  await post([event('delayed', { timestamp: 3000 })]);
  assert.equal(store.read().conversations[0].hasUnreplied, false);
  await post([event('latest', { timestamp: 5000 })]);
  assert.equal(store.read().conversations[0].hasUnreplied, true);
});

test('同名のLINE・Slackユーザーを別Contactとして保存する', async t => {
  const { post, store } = await setup(t, { getDisplayName: async () => '佐藤' });
  await store.update(state => Object.assign(state, demoState()));
  await post([event()]);
  const contacts = store.read().contacts.filter(item => item.displayName === '佐藤');
  assert.equal(contacts.length, 2);
  assert.deepEqual(contacts.map(item => item.platform).sort(), ['line', 'slack']);
});

test('保存失敗で500を返し、再配信時に復旧する', async t => {
  let fail = true;
  const io = { ...fs, rename: async (...args) => {
    if (fail) throw new Error('private-storage-details');
    return fs.rename(...args);
  } };
  const { post, store } = await setup(t, {}, { io });
  const result = await post([event()]);
  assert.equal(result.status, 500);
  assert.equal(result.body.error.code, 'STORAGE_ERROR');
  assert.ok(!JSON.stringify(result).includes('private-storage-details'));
  assert.equal(store.read().messages.length, 0);
  fail = false;
  assert.equal((await post([event()])).status, 200);
  assert.equal(store.read().messages.length, 1);
});

test('公開Webhook受け口から管理APIへアクセスできず、1MB超過を拒否する', async t => {
  const { webhook, post, store } = await setup(t);
  assert.equal((await fetch(`${webhook}/api/contacts`)).status, 404);
  assert.equal((await fetch(`${webhook}/api/health`)).status, 404);
  assert.equal((await post([], { body: 'x'.repeat(1024 * 1024 + 1) })).status, 413);
  assert.equal(store.read().messages.length, 0);
});

test('プロフィールclientはTokenをBackend内で使い、失敗を安全なエラーへ変換', async () => {
  let count = 0;
  const client = createLineClient({ accessToken: 'test-only-access-token', fetchImpl: async (url, options) => {
    count++;
    assert.equal(url, 'https://api.line.me/v2/bot/profile/U_TEST');
    assert.equal(options.headers.Authorization, 'Bearer test-only-access-token');
    return { ok: true, json: async () => ({ displayName: '山田' }) };
  } });
  assert.equal(await client.getDisplayName('U_TEST'), '山田');
  assert.equal(await client.getDisplayName('U_TEST'), '山田');
  assert.equal(count, 1);
  const missing = createLineClient({ accessToken: '' });
  await assert.rejects(missing.getDisplayName('U_TEST'), error => error.code === 'PROVIDER_NOT_CONFIGURED');
  for (const fetchImpl of [async () => { throw new Error('private-request-data'); },
    async () => ({ ok: false }), async () => ({ ok: true, json: async () => ({ displayName: 1 }) })]) {
    const bad = createLineClient({ accessToken: 'test-only-access-token', fetchImpl });
    await assert.rejects(bad.getDisplayName('U_TEST'), error => error.code === 'PROVIDER_ERROR' &&
      !error.message.includes('private-request-data'));
  }
});

test('Mapperは固有JSONから必要な情報だけを抽出する', () => {
  const incoming = mapLineEvent(event());
  assert.equal(incoming.platform, 'line');
  assert.equal(incoming.message.messageType, 'text');
  assert.deepEqual(incoming.message.metadata, { webhookEventId: 'event-message-1' });
  assert.equal(incoming.message.replyToken, undefined);
  assert.equal(mapLineEvent({ type: 'follow' }), null);
});
