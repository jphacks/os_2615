/* 自動テスト専用の架空データ。本番ストレージには投入しない。 */
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
