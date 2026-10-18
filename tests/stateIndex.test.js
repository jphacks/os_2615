import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJsonStore } from '../src/repositories/jsonStore.js';
import { createMessageRepository } from '../src/repositories/messageRepository.js';
import { createContactRepository } from '../src/repositories/contactRepository.js';
import { demoState } from './fixtures/demoState.js';

test('索引は会話を分離し、時刻順・最終メッセージ・名前補完を維持する', async t => {
  const dir = await fs.mkdtemp(join(tmpdir(), 'konekuto-index-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const state = demoState();
  state.contacts[0].nameOverridden = true;
  state.contacts[0].displayName = '別名';
  state.messages.push({ ...state.messages[0], id: 'earlier', platformMessageId: 'earlier', senderName: '初期名', timestamp: '2026-10-16T01:00:00.000Z' });
  const path = join(dir, 'store.json');
  await fs.writeFile(path, JSON.stringify(state));
  const store = await createJsonStore(path);
  const messages = createMessageRepository(store);
  const contacts = createContactRepository(store);
  const history = messages.findHistory(state.contacts[0].id);
  assert.deepEqual(history.messages.map(m => m.id), ['earlier', 'demo-message-line']);
  assert.equal(history.contact.initialName, '初期名');
  assert.equal(contacts.listInbox()[0].lastMessage.id, 'demo-message-line');
  history.messages[0].text = '外部から変更';
  assert.notEqual(messages.findHistory(state.contacts[0].id).messages[0].text, '外部から変更');
  await store.update(draft => {
    draft.messages = draft.messages.filter(m => m.platform !== 'line');
    draft.conversations[0].lastMessageId = null;
    draft.conversations[0].hasUnreplied = false;
  });
  assert.deepEqual(messages.findHistory(state.contacts[0].id).messages, []);
  assert.equal(contacts.listInbox()[0].lastMessage, null);
});

test('失敗した更新では保存済みの索引を維持する', async t => {
  const dir = await fs.mkdtemp(join(tmpdir(), 'konekuto-index-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'store.json');
  await fs.writeFile(path, JSON.stringify(demoState()));
  const store = await createJsonStore(path);
  const repo = createMessageRepository(store);
  const before = repo.findHistory('demo-contact-line');
  await assert.rejects(store.update(draft => { draft.messages = []; throw new Error('abort'); }));
  assert.deepEqual(repo.findHistory('demo-contact-line'), before);
});
