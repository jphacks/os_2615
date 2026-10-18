/*
Slack DMの変換・Bot除外・永続化・Bolt初期化と安全な失敗処理を検証する。実APIは呼ばない。
*/
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { App } from '@slack/bolt';
import { createApp } from '../src/app.js';
import { createJsonStore } from '../src/repositories/jsonStore.js';
import { createMessageRepository } from '../src/repositories/messageRepository.js';
import { createMessageService } from '../src/services/messageService.js';
import { createSlackClient } from '../src/providers/slack/slackClient.js';
import { mapSlackEvent } from '../src/providers/slack/slackMapper.js';
import { createSlackMessageHandler, createSlackReceiver, slackLogger } from '../src/providers/slack/slackEvents.js';
import { mapLineEvent } from '../src/providers/line/lineMapper.js';

const identity = { teamId: 'T_TEST', botUserId: 'U_BOT', botId: 'B_BOT' };
const authResponse = { ok: true, team_id: 'T_TEST', user_id: 'U_BOT', bot_id: 'B_BOT' };
const event = (overrides = {}) => ({ type: 'message', channel_type: 'im', channel: 'D_TEST',
  user: 'U_PERSON', text: '資料を確認してください :smile: 🙌', ts: '1792198800.123456', ...overrides });
const args = (overrides = {}) => ({ event: event(overrides),
  body: { type: 'event_callback', team_id: 'T_TEST', event_id: 'Ev_TEST' } });

async function setup(t, { getDisplayName = async () => '佐藤', io } = {}) {
  const dir = await fs.mkdtemp(join(tmpdir(), 'konekuto-slack-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'store.json');
  const store = await createJsonStore(path, io ? { io } : {});
  const messages = createMessageService(createMessageRepository(store));
  const handle = createSlackMessageHandler(messages, { ...identity, getDisplayName });
  return { path, store, messages, handle };
}

test('Slack DMを共通形式へ変換し絵文字・tsを保持する', () => {
  const mapped = mapSlackEvent(event({ thread_ts: '1792198800.000001' }), { ...identity, eventId: 'Ev_TEST', displayName: '佐藤' });
  assert.equal(mapped.platformUserId, 'T_TEST:U_PERSON');
  assert.equal(mapped.platformConversationId, 'D_TEST');
  assert.equal(mapped.message.platformMessageId, '1792198800.123456');
  assert.equal(mapped.message.timestamp, '2026-10-17T01:00:00.123Z');
  assert.equal(mapped.message.text, '資料を確認してください :smile: 🙌');
  assert.equal(mapped.message.isFromMe, false);
  assert.deepEqual(mapped.message.metadata, { teamId: 'T_TEST', eventId: 'Ev_TEST', threadTs: '1792198800.000001' });
  assert.equal(mapped.message.senderName, '佐藤');
  assert.equal(mapSlackEvent(event({ text: '' }), identity).message.messageType, 'other');
  assert.throws(() => mapSlackEvent(event({ ts: 'invalid' }), identity), error => error.code === 'VALIDATION_ERROR');
});

test('チャンネル・グループDM・Bot・自身・編集等のsubtypeを保存しない', async t => {
  let lookups = 0;
  const { handle, store } = await setup(t, { getDisplayName: async () => { lookups++; return '佐藤'; } });
  for (const override of [
    { channel_type: 'channel', channel: 'C_TEST' }, { channel_type: 'group', channel: 'G_TEST' },
    { channel_type: 'mpim' }, { channel_type: undefined }, { channel: 'C_TEST' },
    { bot_id: 'B_OTHER' }, { bot_profile: {} }, { user: 'U_BOT' },
    { subtype: 'bot_message' }, { subtype: 'message_changed' }, { subtype: 'message_deleted' },
    { subtype: 'file_share' }, { type: 'reaction_added' }
  ]) assert.equal(await handle(args(override)), false);
  assert.equal(store.read().messages.length, 0);
  assert.equal(lookups, 0);
});

test('LINEとSlackの同名Contactを別々に同じInboxへ返す', async t => {
  const { handle, store, messages } = await setup(t);
  await messages.receive(mapLineEvent({ type: 'message', source: { type: 'user', userId: 'U_LINE' },
    timestamp: 1792198800000, webhookEventId: 'Ev_LINE', message: { id: 'line-1', type: 'text', text: 'こんにちは' } }, '佐藤'));
  assert.equal(await handle(args()), true);
  const server = createApp(store).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const inbox = await (await fetch(`${base}/api/contacts?filter=unreplied`)).json();
  assert.equal(inbox.data.length, 2);
  assert.ok(inbox.data.every(item => item.contact.displayName === '佐藤' && item.conversation.hasUnreplied));
  assert.deepEqual(inbox.data.map(item => item.contact.platform).sort(), ['line', 'slack']);
  const slack = inbox.data.find(item => item.contact.platform === 'slack');
  const history = await (await fetch(`${base}/api/contacts/${slack.contact.id}/messages`)).json();
  assert.equal(history.data.messages[0].text, event().text);
  assert.equal(history.data.messages[0].conversationId, slack.conversation.id);
  assert.equal(history.data.reminder, null);
});

test('再配信・並行処理・再起動後の重複を抑止し、別会話の同じtsは保持する', async t => {
  const { handle, store, path } = await setup(t);
  const results = await Promise.all(Array.from({ length: 5 }, () => handle(args())));
  assert.ok(results.some(Boolean));
  assert.equal(store.read().messages.length, 1);
  assert.equal(await handle(args()), false);
  const restarted = await createJsonStore(path);
  const handler = createSlackMessageHandler(createMessageService(createMessageRepository(restarted)), {
    ...identity, getDisplayName: async () => { throw new Error('Should skip duplicate'); }
  });
  assert.equal(await handler(args()), false);
  assert.equal(await handler(args({ channel: 'D_OTHER', user: 'U_OTHER' })), true);
  assert.equal(restarted.read().messages.length, 2);
  assert.equal(restarted.read().contacts.length, 2);
});

test('プロフィール失敗時も保存し、取得済みの表示名を維持する', async t => {
  let fail = true;
  const { handle, store } = await setup(t, { getDisplayName: async () => {
    if (fail) throw new Error('private-error');
    return '佐藤';
  } });
  assert.equal(await handle(args()), true);
  assert.match(store.read().contacts[0].displayName, /^Slackユーザー/);
  fail = false;
  await handle(args({ ts: '1792198801.000001' }));
  fail = true;
  await handle(args({ ts: '1792198802.000001' }));
  assert.equal(store.read().contacts[0].displayName, '佐藤');
  assert.equal(store.read().messages[2].senderName, '佐藤');
  assert.ok(!JSON.stringify(store.read()).includes('private-error'));
});

test('保存失敗・不正イベントをcatchし、後続イベントを処理できる', async t => {
  let fail = true;
  const { handle, store } = await setup(t, { io: { ...fs, rename: async (...values) => {
    if (fail) throw new Error('private-storage-error');
    return fs.rename(...values);
  } } });
  assert.equal(await handle(args()), false);
  assert.equal(store.read().messages.length, 0);
  fail = false;
  assert.equal(await handle(args({ ts: 'bad' })), false);
  assert.equal(await handle(args()), true);
  assert.equal(store.read().messages.length, 1);
  assert.equal(await handle({ ...args(), body: { team_id: 'T_OTHER' } }), false);
});

test('Token未設定・片方のみでは接続しない', async () => {
  for (const [botToken, appToken] of [['', ''], ['test-bot-token', ''], ['', 'test-app-token']]) {
    const receiver = createSlackReceiver({}, { botToken, appToken,
      AppClass: class { constructor() { throw new Error('Must not initialize'); } } });
    assert.equal(await receiver.start(), false);
    await receiver.stop();
    assert.equal(await receiver.start(), false);
  }
});

test('実Boltのイベント処理経路を通して受信でき、停止後は処理しない', async t => {
  const { messages, store } = await setup(t);
  let app;
  let options;
  let starts = 0;
  let stops = 0;
  class StubBolt extends App {
    constructor(value) {
      super(value);
      options = value;
      app = this;
      this.client.auth.test = async () => authResponse;
      this.client.users.info = async () => ({ ok: true, user: { profile: { display_name: '佐藤' } } });
      this.client.chat.postMessage = async ({ channel }) => ({ ok: true, channel, ts: '1792206000.000001' });
    }
    async start() { starts++; }
    async stop() { stops++; }
  }
  const receiver = createSlackReceiver(messages, { botToken: 'test-bot-token', appToken: 'test-app-token', AppClass: StubBolt });
  assert.equal(await receiver.start(), true);
  assert.equal(options.socketMode, true);
  assert.equal(options.ignoreSelf, true);
  assert.equal(options.deferInitialization, true);
  assert.equal(options.logger, slackLogger);
  assert.equal(await receiver.start(), false);
  const sent = await receiver.sendText({ conversation: { platform: 'slack', platformConversationId: 'DTEST' },
    contact: { platform: 'slack', platformUserId: 'T_TEST:U_PERSON' }, text: '返信テスト' });
  assert.equal(sent.isFromMe, true);
  assert.equal(sent.senderId, 'U_BOT');
  assert.equal(sent.text, '返信テスト');
  let acknowledged = 0;
  const deliver = async override => {
    const input = args(override);
    await app.processEvent({ body: { ...input.body, event: input.event }, ack: async () => { acknowledged++; } });
  };
  await deliver();
  assert.equal(store.read().messages.length, 1);
  assert.ok(acknowledged > 0);
  await deliver({ user: 'U_BOT', ts: '1792198801.000001' });
  assert.equal(store.read().messages.length, 1);
  await receiver.stop();
  await assert.rejects(receiver.sendText({}), error => error.code === 'PROVIDER_ERROR');
  await deliver({ ts: '1792198802.000001' });
  assert.equal(store.read().messages.length, 1);
  assert.equal(starts, 1);
  assert.equal(stops, 1);
});

test('認証・Socket接続失敗をcatchしてstopする', async () => {
  for (const stage of ['constructor', 'init', 'identity', 'start']) {
    let stops = 0;
    class FailingApp {
      constructor() {
        if (stage === 'constructor') throw new Error('private-token');
        this.client = { auth: { test: async () => {
          if (stage === 'identity') throw new Error('private-token');
          return authResponse;
        } } };
      }
      error() {}
      event() {}
      async init() { if (stage === 'init') throw new Error('private-token'); }
      async start() { throw new Error('private-token'); }
      async stop() { stops++; }
    }
    const receiver = createSlackReceiver({}, { botToken: 'test-bot-token', appToken: 'test-app-token', AppClass: FailingApp });
    assert.equal(await receiver.start(), false);
    assert.equal(stops, stage === 'constructor' ? 0 : 1);
    await receiver.stop();
  }
});

test('Slack clientは表示名候補・キャッシュ・安全なエラーを扱う', async () => {
  let count = 0;
  const client = createSlackClient({ auth: { test: async () => authResponse }, users: { info: async ({ user }) => {
    count++;
    assert.equal(user, 'U_PERSON');
    return { ok: true, user: { profile: { display_name: '', real_name: '佐藤' } } };
  } } });
  assert.deepEqual(await client.getIdentity(), identity);
  assert.equal(await client.getDisplayName('U_PERSON'), '佐藤');
  assert.equal(await client.getDisplayName('U_PERSON'), '佐藤');
  assert.equal(count, 1);
  const bad = createSlackClient({ auth: { test: async () => ({ ok: true }) }, users: { info: async () => { throw new Error('private-token'); } } });
  await assert.rejects(bad.getIdentity(), error => error.code === 'PROVIDER_ERROR');
  await assert.rejects(bad.getDisplayName('U_PERSON'), error => error.code === 'PROVIDER_ERROR' && !error.message.includes('private-token'));
});

test('SDK loggerへ秘密情報らしい引数を渡しても固定イベント名だけを出力する', () => {
  const entries = [];
  const original = console.log;
  console.log = value => entries.push(value);
  try {
    for (const method of ['debug', 'info', 'warn', 'error']) slackLogger[method]('private-token', { text: 'private-message' });
  } finally { console.log = original; }
  assert.deepEqual(entries.map(value => JSON.parse(value).event), ['SLACK_WARNING', 'SLACK_ERROR']);
  assert.ok(!entries.join('').includes('private-token'));
  assert.ok(!entries.join('').includes('private-message'));
});

test('接続後の切断・再接続タイムアウトをcatchし、再接続・停止できる', async t => {
  const { EventEmitter } = await import('node:events');
  let socket; let attempts = 0; let receiverOptions;
  class Receiver {
    constructor(options) { receiverOptions = options; this.client = new EventEmitter(); socket = this.client; }
  }
  class ReconnectingApp {
    constructor(options) {
      this.receiver = options.receiver;
      this.client = {
        auth: { test: async () => authResponse },
        chat: { postMessage: async () => ({ ok: true, channel: 'D_TEST_DM', ts: '1792200000.000001' }) }
      };
    }
    error() {} event() {} async init() {}
    async start() {
      attempts++;
      if (attempts === 2) throw Object.assign(new Error('private-timeout-details'), { code: 'slack_webapi_request_error' });
    }
    async stop() { this.receiver.client.emit('disconnected'); }
  }
  const receiver = createSlackReceiver({}, { botToken: 'test-bot', appToken: 'test-app', AppClass: ReconnectingApp, ReceiverClass: Receiver, reconnectDelayMs: 5 });
  t.after(() => receiver.stop());
  assert.equal(await receiver.start(), true);
  assert.equal(receiverOptions.autoReconnectEnabled, false);
  socket.emit('disconnected');
  await assert.rejects(receiver.sendText({}), error => error.code === 'PROVIDER_ERROR');
  const deadline = Date.now() + 1000;
  while (attempts < 3 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(attempts, 3);
  await receiver.stop();
  const finalAttempts = attempts;
  socket.emit('disconnected');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(attempts, finalAttempts);
});

test('削除後のSlack再登録はキャッシュを更新して改名を反映する',async t=>{
 let name='旧名', lookups=0;
 const client=createSlackClient({users:{info:async()=>{lookups++;return {ok:true,user:{profile:{display_name:name}}};}}});
 const f=await setup(t,{getDisplayName:client.getDisplayName});
 await f.handle(args());assert.equal(f.store.read().contacts[0].displayName,'旧名');
 name='新名';
 await f.store.update(s=>{s.contacts=[];s.conversations=[];s.messages=[];s.reminders=[];});
 await f.handle({event:event({ts:'1792198801.123456'}),body:{team_id:'T_TEST',event_id:'Ev_NEW'}});
 assert.equal(f.store.read().contacts[0].displayName,'新名');assert.equal(lookups,2);
});
test('Slack表示名キャッシュは5分後に更新し、強制更新失敗で古い名前を返さない',async()=>{
 let clock=0,name='旧名',fail=false;
 const client=createSlackClient({users:{info:async()=>{if(fail)throw Error('network');return {ok:true,user:{profile:{display_name:name}}};}}},{now:()=>clock});
 assert.equal(await client.getDisplayName('U_PERSON'),'旧名');name='新名';assert.equal(await client.getDisplayName('U_PERSON'),'旧名');
 clock=300000;assert.equal(await client.getDisplayName('U_PERSON'),'新名');fail=true;
 await assert.rejects(client.getDisplayName('U_PERSON',{refresh:true}));await assert.rejects(client.getDisplayName('U_PERSON'));
});
