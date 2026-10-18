import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDemoMode, openDemoStore, createDemoProvider } from '../src/demo/demoMode.js';
import { createReplyService } from '../src/services/replyService.js';
import { createMessageRepository } from '../src/repositories/messageRepository.js';
import { createMediaRepository } from '../src/repositories/mediaRepository.js';

test('認証情報なしのみ自動デモ。部分設定と明示指定を区別する', () => {
  assert.equal(isDemoMode({}), true);
  assert.equal(isDemoMode({ LINE_CHANNEL_ACCESS_TOKEN: '  ' }), true);
  for (const key of ['LINE_CHANNEL_ACCESS_TOKEN', 'LINE_CHANNEL_SECRET', 'SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN'])
    assert.equal(isDemoMode({ [key]: 'configured' }), false);
  assert.equal(isDemoMode({ DEMO_MODE: 'false' }), false);
  assert.equal(isDemoMode({ DEMO_MODE: 'true', SLACK_BOT_TOKEN: 'configured' }), true);
});

test('3人のモックを一度だけ作成し、外部通信なしで文章・画像を保存する', async t => {
  const root = await mkdtemp(join(tmpdir(), 'konekuto-demo-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'store.json'), 'real-data-untouched');
  const dir = join(root, 'demo');
  const store = await openDemoStore(dir);
  assert.equal(store.read().contacts.length, 3);
  assert.deepEqual(new Set(store.read().contacts.map(row => row.platform)), new Set(['line', 'slack']));
  assert.ok(store.read().contacts.every(row => row.displayName.includes('モック')));
  assert.ok(store.read().messages.every(row => row.text.startsWith('これはモックアカウントです。')));
  const replies = createReplyService(createMessageRepository(store), {
    line: createDemoProvider('line'), slack: createDemoProvider('slack')
  }, { mediaRepository: createMediaRepository(join(dir, 'media')), publicBaseUrl: 'https://demo.invalid' });
  for (const conversation of store.read().conversations) {
    const result = await replies.reply({ conversationId: conversation.id, text: 'モックへの返信' });
    assert.equal(result.message.text, 'モックへの返信');
    assert.equal(result.message.metadata.demo, true);
    const image = await replies.replyImage(conversation.id, Buffer.from([137,80,78,71,13,10,26,10]));
    assert.equal(image.message.messageType, 'image');
  }
  const reopened = await openDemoStore(dir);
  assert.equal(reopened.read().contacts.length, 3);
  assert.equal(reopened.read().messages.length, 9);
  assert.equal(await readFile(join(root, 'store.json'), 'utf8'), 'real-data-untouched');
  await reopened.update(state => {
    state.contacts=[]; state.conversations=[]; state.messages=[]; state.tabs=[];
  });
  assert.equal((await openDemoStore(dir)).read().contacts.length, 0);
});

test('破損したデモ保存データをモックで上書きしない', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'konekuto-demo-invalid-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'store.json'), 'broken');
  await assert.rejects(openDemoStore(dir));
  assert.equal(await readFile(join(dir, 'store.json'), 'utf8'), 'broken');
});
