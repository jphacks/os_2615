/*
返信API・外部送信の変換・未返信解除・送信中の競合と失敗時の状態保護を検証する。
実際のLINE・Slackへは送信しない。
*/
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { createJsonStore } from '../src/repositories/jsonStore.js';
import { createMessageRepository } from '../src/repositories/messageRepository.js';
import { createMessageService } from '../src/services/messageService.js';
import { createLineClient } from '../src/providers/line/lineClient.js';
import { createSlackClient } from '../src/providers/slack/slackClient.js';
import { createSlackReceiver } from '../src/providers/slack/slackEvents.js';
import { AppError } from '../src/utils/errors.js';
import { demoState } from '../scripts/seedDemo.js';

const lineId = 'demo-conversation-line';
const slackId = 'demo-conversation-slack';
const lineUser = 'U' + 'a'.repeat(32);
const lineTarget = { conversation: { platform: 'line', platformConversationId: lineUser },
  contact: { platform: 'line', platformUserId: lineUser } };
const slackTarget = { conversation: { platform: 'slack', platformConversationId: 'DTEST' },
  contact: { platform: 'slack', platformUserId: 'T_TEST:U_PERSON' } };
const auth = { ok: true, team_id: 'T_TEST', user_id: 'U_BOT', bot_id: 'B_BOT' };
const sent = (platform, text, extra = {}) => ({ platform, messageType: 'text', platformMessageId: `sent-${platform}`,
  senderId: `bot-${platform}`, senderName: '自分', text, timestamp: '2026-10-17T03:00:00.000Z', isFromMe: true, metadata: {}, ...extra });
const provider = platform => ({ sendText: async ({ text }) => sent(platform, text) });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function setup(t, { providers = { line: provider('line'), slack: provider('slack') }, io } = {}) {
  const dir = await fs.mkdtemp(join(tmpdir(), 'konekuto-reply-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'store.json');
  const store = await createJsonStore(path, io ? { io } : {});
  await store.update(state => {
    Object.assign(state, demoState());
    state.reminders = state.messages.map(message => ({ id: `reminder-${message.platform}`,
      messageId: message.id, conversationId: message.conversationId, remindAt: '2026-10-18T00:00:00.000Z', status: 'pending' }));
  });
  const server = createApp(store, { providers }).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (body, suffix = '') => {
    const response = await fetch(`${base}/api/messages/reply${suffix}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  };
  const receive = async (timestamp, platformMessageId = 'new-incoming') => createMessageService(createMessageRepository(store)).receive({
    platform: 'line', platformUserId: 'demo-user-line', platformConversationId: 'demo-destination-line', displayName: null,
    message: { ...demoState().messages[0], platformMessageId, timestamp, text: '新しい質問', metadata: {} }
  });
  return { store, path, base, request, receive };
}

test('両Providerへの返信成功後に履歴・未返信・Reminderを一括更新する', async t => {
  const { store, path, request, base } = await setup(t);
  for (const [conversationId, platform] of [[lineId, 'line'], [slackId, 'slack']]) {
    const text = '  こんにちは\n13時でどう？  ';
    const result = await request({ conversationId, text });
    assert.equal(result.status, 201);
    const { message, conversation } = result.body.data;
    assert.equal(message.platform, platform);
    assert.equal(message.senderName, '自分');
    assert.equal(message.senderId, `bot-${platform}`);
    assert.equal(message.isFromMe, true);
    assert.equal(message.text, text);
    assert.equal(message.conversationId, conversationId);
    assert.equal(conversation.lastMessageId, message.id);
    assert.equal(conversation.hasUnreplied, false);
    const state = store.read();
    assert.equal(state.reminders.find(item => item.conversationId === conversationId).status, 'done');
    assert.equal(state.contacts.find(item => item.id === conversation.contactId).lastMessageAt, message.timestamp);
  }
  const filtered = await (await fetch(`${base}/api/contacts?filter=unreplied`)).json();
  assert.deepEqual(filtered.data, []);
  assert.deepEqual((await createJsonStore(path)).read(), store.read());
  assert.equal(store.read().messages.length, 4);
});

test('入力検証・不在会話ではProviderを呼ばず履歴を変更しない', async t => {
  let calls = 0;
  const { request, store } = await setup(t, { providers: { line: { sendText: async () => { calls++; } } } });
  for (const body of [null, [], {}, { text: 'hi' }, { conversationId: lineId },
    { conversationId: lineId, text: '' }, { conversationId: lineId, text: ' \n ' },
    { conversationId: lineId, text: 123 }, { conversationId: 123, text: 'hi' },
    { conversationId: lineId, text: 'x'.repeat(5001) }, { conversationId: lineId, text: 'hi', platform: 'slack' },
    { conversationId: lineId, text: 'hi', to: 'other-user' }]) {
    const result = await request(body);
    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'VALIDATION_ERROR');
  }
  assert.equal((await request({ conversationId: 'missing', text: 'hi' })).status, 404);
  assert.equal((await request({ conversationId: lineId, text: 'hi' }, '?extra=1')).status, 400);
  assert.equal(calls, 0);
  assert.equal(store.read().messages.length, 2);
});

test('5000 UTF-16単位までを許可し、超過は拒否する', async t => {
  const { request } = await setup(t);
  assert.equal((await request({ conversationId: lineId, text: '🙌'.repeat(2500) })).status, 201);
  assert.equal((await request({ conversationId: lineId, text: '🙌'.repeat(2501) })).status, 400);
});

test('Provider失敗時は未返信・Reminder・履歴を維持し、ロックを解除する', async t => {
  let fail = true;
  const { request, store } = await setup(t, { providers: { line: { sendText: async ({ text }) => {
    if (fail) throw new AppError(502, 'PROVIDER_ERROR', '外部送信に失敗しました。');
    return sent('line', text);
  } } } });
  const before = store.read();
  const result = await request({ conversationId: lineId, text: 'hello' });
  assert.equal(result.status, 502);
  assert.equal(result.body.error.code, 'PROVIDER_ERROR');
  assert.deepEqual(store.read(), before);
  fail = false;
  assert.equal((await request({ conversationId: lineId, text: 'hello' })).status, 201);
});

test('送信結果不明は自動再送せず、安全なDELIVERY_UNKNOWNを返す', async t => {
  let calls = 0;
  const { request, store } = await setup(t, { providers: { line: { sendText: async () => {
    calls++; throw new Error('private-token-and-request');
  } } } });
  const before = store.read();
  const result = await request({ conversationId: lineId, text: 'hello' });
  assert.equal(result.status, 502);
  assert.equal(result.body.error.code, 'DELIVERY_UNKNOWN');
  assert.ok(!JSON.stringify(result).includes('private-token-and-request'));
  assert.equal(calls, 1);
  assert.deepEqual(store.read(), before);
});

test('送信成功後の保存失敗はDELIVERY_UNKNOWNとなり、状態を部分更新しない', async t => {
  let fail = false;
  let calls = 0;
  const { request, store, path } = await setup(t, {
    io: { ...fs, rename: async (...values) => {
      if (fail) throw new Error('private-disk-error');
      return fs.rename(...values);
    } },
    providers: { line: { sendText: async ({ text }) => { calls++; return sent('line', text); } } }
  });
  const before = store.read();
  const disk = await fs.readFile(path, 'utf8');
  fail = true;
  const result = await request({ conversationId: lineId, text: 'hello' });
  assert.equal(result.status, 500);
  assert.equal(result.body.error.code, 'DELIVERY_UNKNOWN');
  assert.equal(calls, 1);
  assert.deepEqual(store.read(), before);
  assert.equal(await fs.readFile(path, 'utf8'), disk);
});

test('同じ会話の並行送信は409、別会話の送信は処理できる', async t => {
  const entered = deferred();
  const gate = deferred();
  let calls = 0;
  const { request } = await setup(t, { providers: { slack: provider('slack'), line: { sendText: async ({ text }) => {
    calls++; entered.resolve(); await gate.promise; return sent('line', text);
  } } } });
  const first = request({ conversationId: lineId, text: 'first' });
  try {
    await entered.promise;
    const second = await request({ conversationId: lineId, text: 'second' });
    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, 'REPLY_IN_PROGRESS');
    assert.equal((await request({ conversationId: slackId, text: 'separate' })).status, 201);
    assert.equal(calls, 1);
  } finally { gate.resolve(); }
  assert.equal((await first).status, 201);
});

test('送信中の新着は未返信のまま残し、その後の遅延イベントでも解除しない', async t => {
  const entered = deferred();
  const gate = deferred();
  const { request, store, receive, path } = await setup(t, { providers: { line: { sendText: async ({ text }) => {
    entered.resolve(); await gate.promise; return sent('line', text);
  } } } });
  const first = request({ conversationId: lineId, text: 'old question reply' });
  try {
    await entered.promise;
    await receive('2026-10-17T02:59:00.000Z');
  } finally { gate.resolve(); }
  assert.equal((await first).body.data.conversation.hasUnreplied, true);
  await receive('2026-10-17T00:00:00.000Z', 'delayed');
  assert.equal(store.read().conversations.find(item => item.id === lineId).hasUnreplied, true);
  assert.equal((await createJsonStore(path)).read().conversations.find(item => item.id === lineId).hasUnreplied, true);
  assert.equal((await request({ conversationId: lineId, text: 'new question reply' })).body.data.conversation.hasUnreplied, false);
});

test('送信中に再設定・取消されたReminderをdoneに上書きしない', async t => {
  for (const action of ['reschedule', 'cancel']) {
    const entered = deferred(); const gate = deferred();
    const { request, store } = await setup(t, { providers: { line: { sendText: async ({ text }) => {
      entered.resolve(); await gate.promise; return sent('line', text);
    } } } });
    const response = request({ conversationId: lineId, text: 'hello' });
    try {
      await entered.promise;
      await store.update(state => {
        const reminder = state.reminders.find(item => item.conversationId === lineId);
        if (action === 'reschedule') reminder.remindAt = '2026-10-19T00:00:00.000Z';
        else reminder.status = 'cancelled';
      });
    } finally { gate.resolve(); }
    assert.equal((await response).status, 201);
    assert.equal(store.read().reminders.find(item => item.conversationId === lineId).status,
      action === 'reschedule' ? 'pending' : 'cancelled');
  }
});

test('未設定Providerは503、送信結果の不正形式は保存せず結果不明にする', async t => {
  const absent = await setup(t, { providers: {} });
  const result = await absent.request({ conversationId: lineId, text: 'hello' });
  assert.equal(result.status, 503);
  assert.equal(result.body.error.code, 'PROVIDER_NOT_CONFIGURED');
  for (const extra of [{ platformMessageId: '' }, { platform: 'slack' }, { text: 'different' }, { metadata: null }]) {
    const { request, store } = await setup(t, { providers: { line: { sendText: async ({ text }) => sent('line', text, extra) } } });
    const reply = await request({ conversationId: lineId, text: 'hello' });
    assert.equal(reply.status, 500);
    assert.equal(reply.body.error.code, 'DELIVERY_UNKNOWN');
    assert.equal(store.read().messages.length, 2);
  }
});

test('LINEはuserIdへPushし、replyTokenを使わず送信結果を共通形式へ変換する', async () => {
  const requests = [];
  const client = createLineClient({ accessToken: 'test-only-access-token', fetchImpl: async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('/info')) return { ok: true, json: async () => ({ userId: 'U_BOT' }) };
    return { ok: true, json: async () => ({ sentMessages: [{ id: 'line-sent-id', quoteToken: 'not-saved' }] }) };
  } });
  const text = '  13時でどう？\n';
  const message = await client.sendText({ ...lineTarget, text });
  assert.equal(message.senderId, 'U_BOT');
  assert.equal(message.platformMessageId, 'line-sent-id');
  assert.equal(message.isFromMe, true);
  assert.equal(message.text, text);
  assert.deepEqual(message.metadata, {});
  assert.equal(requests[1].url, 'https://api.line.me/v2/bot/message/push');
  assert.equal(requests[1].options.headers.Authorization, 'Bearer test-only-access-token');
  assert.deepEqual(JSON.parse(requests[1].options.body), { to: lineUser, messages: [{ type: 'text', text }] });
  assert.ok(!JSON.stringify(message).includes('not-saved'));
  await client.sendText({ ...lineTarget, text: 'again' });
  assert.equal(requests.filter(item => item.url.endsWith('/info')).length, 1);
  assert.equal(requests.filter(item => item.url.endsWith('/push')).length, 2);
});

test('LINEの未設定・送信前失敗・明確な拒否・送信結果不明を区別する', async () => {
  const missing = createLineClient({ accessToken: '', fetchImpl: async () => { throw new Error('Must not call'); } });
  await assert.rejects(missing.sendText({ ...lineTarget, text: 'hello' }), error => error.code === 'PROVIDER_NOT_CONFIGURED');
  const beforeSend = createLineClient({ accessToken: 'test-only-access-token', fetchImpl: async () => { throw new Error('private-error'); } });
  await assert.rejects(beforeSend.sendText({ ...lineTarget, text: 'hello' }), error => error.code === 'PROVIDER_ERROR');
  for (const status of [400, 401, 403, 429, 408, 500]) {
    let pushes = 0;
    const client = createLineClient({ accessToken: 'test-only-access-token', fetchImpl: async url => {
      if (url.endsWith('/info')) return { ok: true, json: async () => ({ userId: 'U_BOT' }) };
      pushes++; return { ok: false, status, json: async () => { throw new Error('Do not expose private error body'); } };
    } });
    await assert.rejects(client.sendText({ ...lineTarget, text: 'hello' }), error =>
      error.code === (status >= 500 || status === 408 ? 'DELIVERY_UNKNOWN' : 'PROVIDER_ERROR'));
    assert.equal(pushes, 1);
  }
  for (const failure of ['network', 'malformed']) {
    const client = createLineClient({ accessToken: 'test-only-access-token', fetchImpl: async url => {
      if (url.endsWith('/info')) return { ok: true, json: async () => ({ userId: 'U_BOT' }) };
      if (failure === 'network') throw new Error('private-error');
      return { ok: true, json: async () => ({}) };
    } });
    await assert.rejects(client.sendText({ ...lineTarget, text: 'hello' }), error => error.code === 'DELIVERY_UNKNOWN' && !error.message.includes('private-error'));
  }
});

test('Slackは保存済みDM channelへ投稿しBot ID・tsを共通形式へ変換する', async () => {
  let authCalls = 0;
  const posts = [];
  const client = createSlackClient({ auth: { test: async () => { authCalls++; return auth; } }, chat: {
    postMessage: async input => { posts.push(input); return { ok: true, channel: 'DTEST', ts: '1792206000.000001' }; }
  } });
  const text = '  ありがとう :smile: 🙌\n';
  const message = await client.sendText({ ...slackTarget, text });
  assert.equal(message.senderId, 'U_BOT');
  assert.equal(message.platformMessageId, '1792206000.000001');
  assert.equal(message.timestamp, '2026-10-17T03:00:00.000Z');
  assert.equal(message.text, text);
  assert.deepEqual(posts[0], { channel: 'DTEST', text, mrkdwn: false, unfurl_links: false, unfurl_media: false });
  await client.sendText({ ...slackTarget, text: 'again' });
  assert.equal(authCalls, 1);
  assert.equal(posts.length, 2);
});

test('Slackの明確なAPI拒否と送信結果不明を区別し、自動再送しない', async () => {
  const cases = [
    [{ code: 'slack_webapi_platform_error', data: { error: 'missing_scope' } }, 'PROVIDER_ERROR'],
    [{ code: 'slack_webapi_platform_error', data: { error: 'internal_error' } }, 'DELIVERY_UNKNOWN'],
    [{ code: 'slack_webapi_rate_limited_error' }, 'PROVIDER_ERROR'],
    [{ code: 'slack_webapi_http_error', statusCode: 403 }, 'PROVIDER_ERROR'],
    [{ code: 'slack_webapi_http_error', statusCode: 500 }, 'DELIVERY_UNKNOWN'],
    [{ code: 'slack_webapi_request_error' }, 'DELIVERY_UNKNOWN'],
    [null, 'DELIVERY_UNKNOWN']
  ];
  for (const [failure, code] of cases) {
    let posts = 0;
    const client = createSlackClient({ auth: { test: async () => auth }, chat: { postMessage: async () => { posts++; throw failure; } } });
    await assert.rejects(client.sendText({ ...slackTarget, text: 'hello' }), error => error.code === code);
    assert.equal(posts, 1);
  }
  for (const response of [{ ok: false, error: 'not_authed' }, { ok: true, channel: 'D_OTHER', ts: '1792206000.000001' },
    { ok: true, channel: 'DTEST', ts: 'bad' }]) {
    const client = createSlackClient({ auth: { test: async () => auth }, chat: { postMessage: async () => response } });
    await assert.rejects(client.sendText({ ...slackTarget, text: 'hello' }), error =>
      error.code === (response.ok ? 'DELIVERY_UNKNOWN' : 'PROVIDER_ERROR'));
  }
});

test('Slack Receiverは未設定・接続前の返信を拒否する', async () => {
  const missing = createSlackReceiver({}, { botToken: '', appToken: '' });
  await assert.rejects(missing.sendText({ ...slackTarget, text: 'hello' }), error => error.code === 'PROVIDER_NOT_CONFIGURED');
  const pending = createSlackReceiver({}, { botToken: 'test-only-bot-token', appToken: 'test-only-app-token' });
  await assert.rejects(pending.sendText({ ...slackTarget, text: 'hello' }), error => error.code === 'PROVIDER_ERROR');
});
