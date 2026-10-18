import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSlackClient } from '../src/providers/slack/slackClient.js';
import { createSlackReceiver } from '../src/providers/slack/slackEvents.js';
import { createApp } from '../src/app.js';
import { createSplitStore } from '../src/repositories/splitStore.js';
import { createMediaRepository } from '../src/repositories/mediaRepository.js';
import { demoState } from './fixtures/demoState.js';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=', 'base64');
const target = { conversation: { platform: 'slack', platformConversationId: 'DTEST' }, contact: { platform: 'slack', platformUserId: 'T_TEST:U_PERSON' } };
const media = { id: '12345678-1234-1234-1234-123456789abc.png', url: '/api/media/12345678-1234-1234-1234-123456789abc.png', mimeType: 'image/png', size: png.length };
const sdk = upload => ({ auth: { test: async () => ({ ok: true, team_id: 'T_TEST', user_id: 'UBOT', bot_id: 'BBOT' }) }, filesUploadV2: upload });
const success = { ok: true, files: [{ ok: true, files: [{ id: 'F123', url_private: 'private-url-must-not-persist' }] }] };
test('Slack画像送信はBufferと保存済みDM先をUploadV2へ渡し、共通履歴を返す', async () => {
  let called;
  const client = createSlackClient(sdk(async input => { called = input; return success; }));
  const result = await client.sendImage({ ...target, media, bytes: png });
  assert.equal(called.channel_id, 'DTEST'); assert.equal(called.filename, 'konekuto.png'); assert.deepEqual(called.file, png);
  assert.equal(result.platformMessageId, 'F123'); assert.equal(result.messageType, 'image'); assert.deepEqual(result.media, media);
  assert.equal(result.text, '[画像]'); assert.ok(!JSON.stringify(result).includes('private-url'));
});
test('Slack画像の権限不足と通信結果不明を区別し、内部情報を公開しない', async () => {
  for (const [failure, code] of [[{ data: { error: 'missing_scope' }, message: 'private' }, 'SLACK_FILE_WRITE_PERMISSION'], [{ code: 'slack_webapi_request_error', message: 'secret-token' }, 'DELIVERY_UNKNOWN']]) {
    const client = createSlackClient(sdk(async () => { throw failure; }));
    await assert.rejects(client.sendImage({ ...target, media, bytes: png }), error => error.code === code && !error.message.includes('secret-token') && !error.message.includes('private'));
  }
  const bad = createSlackClient(sdk(async () => ({ ok: true, files: [] })));
  await assert.rejects(bad.sendImage({ ...target, media, bytes: png }), error => error.code === 'DELIVERY_UNKNOWN');
});
test('別チーム・不正画像・上限超過はSlackへアップロードしない', async () => {
  let calls = 0;
  const client = createSlackClient(sdk(async () => { calls++; return success; }));
  for (const input of [{ ...target, contact: { platform: 'slack', platformUserId: 'OTHER:U1' }, media, bytes: png }, { ...target, media, bytes: Buffer.from('not-image') }, { ...target, media, bytes: Buffer.alloc(1024 * 1024 + 1) }]) await assert.rejects(client.sendImage(input));
  assert.equal(calls, 0);
  const receiver = createSlackReceiver({}, { botToken: '', appToken: '' });
  await assert.rejects(receiver.sendImage({}), error => error.code === 'PROVIDER_NOT_CONFIGURED');
});
test('Slack画像APIは公開URLなしで送信・保存・ダウンロードし、失敗で履歴を増やさない', async t => {
  const dir = await fs.mkdtemp(join(tmpdir(), 'konekuto-slack-send-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const state = demoState(); state.conversations[1].platformConversationId = 'DTEST'; state.contacts[1].platformUserId = 'T_TEST:U_PERSON';
  const path = join(dir, 'store.json'); await fs.writeFile(path, JSON.stringify(state));
  const store = await createSplitStore(path), repository = createMediaRepository(join(dir, 'media'));
  let fail = false, calls = 0;
  const slack = createSlackClient(sdk(async () => { calls++; if (fail) throw { data: { error: 'missing_scope' } }; return success; }));
  const server = createApp(store, { providers: { slack }, mediaRepository: repository, publicBaseUrl: '' }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = bytes => fetch(base + '/api/messages/reply-image?conversationId=demo-conversation-slack', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: bytes });
  assert.equal((await send(png)).status, 201); assert.equal(calls, 1);
  const message = store.read().messages.at(-1); assert.equal(message.platform, 'slack'); assert.equal(message.messageType, 'image');
  const downloaded = await fetch(base + message.media.url + '/download'); assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), png);
  assert.deepEqual(await fs.readFile(join(dir, 'media', 'slack', message.media.id)), png);
  assert.equal((await send(Buffer.from('invalid'))).status, 400); assert.equal(calls, 1);
  fail = true; const response = await send(png); assert.equal(response.status, 502); assert.equal((await response.json()).error.code, 'SLACK_FILE_WRITE_PERMISSION');
  assert.equal(store.read().messages.length, 3);
});
