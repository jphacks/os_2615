/*
共通受信データを保存し、Contactに紐づく会話履歴を取得する。
*/
import { randomUUID } from 'node:crypto';

function duplicate(state, incoming) {
  return state.messages.find(message => message.platform === incoming.platform &&
    ((message.platformMessageId === incoming.message.platformMessageId &&
      state.conversations.some(conversation => conversation.id === message.conversationId &&
        conversation.platformConversationId === incoming.platformConversationId)) ||
      (incoming.message.metadata.webhookEventId &&
        message.metadata?.webhookEventId === incoming.message.metadata.webhookEventId)));
}

export function createMessageRepository(store) {
  return {
    isDuplicate(incoming) { return Boolean(duplicate(store.read(), incoming)); },
    receive(incoming) {
      return store.update(state => {
        const existing = duplicate(state, incoming);
        if (existing) return existing;
        let contact = state.contacts.find(item => item.platform === incoming.platform && item.platformUserId === incoming.platformUserId);
        if (!contact) {
          contact = { id: randomUUID(), platform: incoming.platform, platformUserId: incoming.platformUserId,
            displayName: incoming.displayName ?? incoming.message.senderName, isFavorite: false,
            lastMessageAt: incoming.message.timestamp };
          state.contacts.push(contact);
        } else if (incoming.displayName) {
          contact.displayName = incoming.displayName;
        }
        let conversation = state.conversations.find(item => item.contactId === contact.id);
        if (!conversation) {
          conversation = { id: randomUUID(), platform: incoming.platform,
            platformConversationId: incoming.platformConversationId, contactId: contact.id,
            lastMessageId: '', hasUnreplied: true, updatedAt: incoming.message.timestamp };
          state.conversations.push(conversation);
        }
        const message = { ...incoming.message, id: randomUUID(), conversationId: conversation.id,
          senderName: incoming.displayName ?? contact.displayName };
        state.messages.push(message);
        const latest = state.messages.filter(item => item.conversationId === conversation.id)
          .reduce((a, b) => Date.parse(b.timestamp) >= Date.parse(a.timestamp) ? b : a);
        conversation.lastMessageId = latest.id;
        conversation.updatedAt = latest.timestamp;
        conversation.hasUnreplied = !latest.isFromMe;
        contact.lastMessageAt = latest.timestamp;
        return message;
      });
    },
    findHistory(contactId) {
      const state = store.read();
      const contact = state.contacts.find(item => item.id === contactId);
      if (!contact) return null;
      const conversation = state.conversations.find(item => item.contactId === contactId);
      if (!conversation) throw new Error('Missing conversation');
      return {
        contact,
        conversation,
        messages: state.messages.filter(item => item.conversationId === conversation.id)
          .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)),
        reminder: state.reminders.find(item => item.conversationId === conversation.id && item.status === 'pending') ?? null
      };
    }
  };
}
