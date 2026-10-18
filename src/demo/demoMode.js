/* 認証情報なしで試すデモ。実データと送信先を完全に分離する。 */
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { createSplitStore } from '../repositories/splitStore.js';

export function isDemoMode(env = process.env) {
  if (env.DEMO_MODE === 'true') return true;
  if (env.DEMO_MODE === 'false') return false;
  return !['LINE_CHANNEL_ACCESS_TOKEN', 'LINE_CHANNEL_SECRET', 'SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN']
    .some(key => env[key]?.trim());
}

export async function openDemoStore(directory) {
  const path = join(directory, 'store.json');
  let fresh = false;
  try { await access(path); } catch (error) { if (error.code !== 'ENOENT') throw error; fresh = true; }
  const store = await createSplitStore(path);
  if (fresh) await store.update(state => {
    const timestamp = new Date().toISOString();
    for (const [index, platform, name] of [[1, 'line', '山田'], [2, 'slack', '佐藤'], [3, 'line', '鈴木']]) {
      const id = `mock-contact-${index}`, conversationId = `mock-conversation-${index}`, messageId = `mock-message-${index}`;
      const displayName = `${name}（モック）`;
      state.contacts.push({ id, platform, platformUserId: `mock-user-${index}`, displayName,
        initialName: displayName, isFavorite: index === 1, lastMessageAt: timestamp });
      state.conversations.push({ id: conversationId, platform, platformConversationId: `mock-destination-${index}`,
        contactId: id, lastMessageId: messageId, hasUnreplied: true, updatedAt: timestamp });
      state.messages.push({ id: messageId, platform, messageType: 'text', platformMessageId: `mock-remote-${index}`,
        senderId: `mock-user-${index}`, senderName: displayName, conversationId,
        text: 'これはモックアカウントです。\n返信や画像送信を試せます。送信内容はこの端末に保存され、LINE・Slackには送信されません。',
        timestamp, isFromMe: false, metadata: { demo: true } });
    }
    state.tabs = [{ id: 'mock-tab', name: 'デモ', contactIds: state.contacts.map(contact => contact.id) }];
  });
  return store;
}

export function createDemoProvider(platform) {
  const draft = (text, media) => ({ platform, messageType: media ? 'image' : 'text',
    platformMessageId: `mock-sent-${randomUUID()}`, senderId: 'mock-self', text,
    timestamp: new Date().toISOString(), isFromMe: true, metadata: { demo: true }, ...(media ? { media } : {}) });
  return {
    async sendText({ text }) { return draft(text); },
    async sendImage({ media }) { return draft('[画像]', media); },
    async start() {}, async stop() {}
  };
}
