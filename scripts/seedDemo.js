/*
明示実行時だけ架空のLINE・Slack会話を投入する。既存データは上書きしない。
*/
import { fileURLToPath } from 'node:url';
import { createJsonStore } from '../src/repositories/jsonStore.js';
import { logEvent } from '../src/utils/logger.js';

export function demoState() {
  const state = { version: 1, contacts: [], conversations: [], messages: [], reminders: [] };
  for (const [platform, name, text] of [
    ['line', '山田', '明日の集合時間どうする？'],
    ['slack', '佐藤', '資料を確認してください :smile:']
  ]) {
    const timestamp = '2026-10-17T01:00:00.000Z';
    const contactId = `demo-contact-${platform}`;
    const conversationId = `demo-conversation-${platform}`;
    const id = `demo-message-${platform}`;
    state.contacts.push({ id: contactId, platform, platformUserId: `demo-user-${platform}`,
      displayName: name, isFavorite: false, lastMessageAt: timestamp });
    state.conversations.push({ id: conversationId, platform, platformConversationId: `demo-destination-${platform}`,
      contactId, lastMessageId: id, hasUnreplied: true, updatedAt: timestamp });
    state.messages.push({ id, platform, messageType: 'text', platformMessageId: `demo-remote-${platform}`,
      senderId: `demo-user-${platform}`, senderName: name, conversationId, text, timestamp,
      isFromMe: false, metadata: {} });
  }
  return state;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const store = await createJsonStore(fileURLToPath(new URL('../data/store.json', import.meta.url)));
    await store.update(state => {
      if (['contacts', 'conversations', 'messages', 'reminders'].some(key => state[key].length)) {
        throw new Error('Existing data');
      }
      Object.assign(state, demoState());
    });
    console.log('架空データを保存しました。実サービスには接続していません。');
  } catch {
    logEvent('STARTUP_FAILED');
    console.error('投入を中止しました。既存データまたは保存先を確認してください。');
    process.exitCode = 1;
  }
}
