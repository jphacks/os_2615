/*
共通受信データを保存し、Contactに紐づく会話履歴を取得する。
*/
import { initialContactName } from './contactName.js';
import { randomUUID } from 'node:crypto';
import { createSentMessage } from '../models/message.js';
import { notFound, invalidInput } from '../utils/errors.js';

function refreshLatest(state, conversation, contact) {
  const latest = state.messages.filter(item => item.conversationId === conversation.id)
    .reduce((a, b) => Date.parse(b.timestamp) >= Date.parse(a.timestamp) ? b : a);
  conversation.lastMessageId = latest.id;
  conversation.updatedAt = latest.timestamp;
  contact.lastMessageAt = latest.timestamp;
  return latest;
}

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
    hasContact(incoming) {
      return store.read().contacts.some(contact => contact.platform === incoming.platform && contact.platformUserId === incoming.platformUserId);
    },
    getReplyContext(conversationId) {
      const state = store.read();
      const conversation = state.conversations.find(item => item.id === conversationId);
      if (!conversation) throw notFound();
      const contact = state.contacts.find(item => item.id === conversation.contactId);
      if (!contact || contact.platform !== conversation.platform) throw invalidInput();
      return { conversation, contact,
        reminder: state.reminders.find(item => item.conversationId === conversationId && item.status === 'pending') ?? null };
    },
    saveReply(context, draft, scheduledId) {
      return store.update(state => {
        const conversation = state.conversations.find(item => item.id === context.conversation.id);
        if (!conversation || draft.platform !== conversation.platform) throw invalidInput();
        const contact = state.contacts.find(item => item.id === conversation.contactId);
        if (!contact) throw invalidInput();
        const currentLast = state.messages.find(item => item.id === conversation.lastMessageId);
        const newIncoming = conversation.lastMessageId !== context.conversation.lastMessageId && currentLast?.isFromMe === false;
        if (scheduledId) {
          const job = (state.scheduledMessages ?? []).find(row => row.id === scheduledId);
          if (!job || job.status !== 'sending' || job.conversationId !== conversation.id || job.text !== draft.text) throw invalidInput();
          job.status = 'sent';
        }
        const message = createSentMessage(draft, conversation.id);
        state.messages.push(message);
        const latest = refreshLatest(state, conversation, contact);
        conversation.hasUnreplied = newIncoming || !latest.isFromMe;
        if (context.reminder) {
          const reminder = state.reminders.find(item => item.id === context.reminder.id);
          if (reminder?.status === 'pending' && reminder.remindAt === context.reminder.remindAt &&
              reminder.messageId === context.reminder.messageId) reminder.status = 'done';
        }
        return { message, conversation };
      });
    },
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
          contact.initialName = contact.displayName;
          state.contacts.push(contact);
        } else {
          contact.initialName ??= initialContactName(state, contact);
          if (incoming.displayName && !contact.nameOverridden) contact.displayName = incoming.displayName;
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
        const latest = refreshLatest(state, conversation, contact);
        // 遅延イベントで、返信中の新着に対して残した未返信状態を消さない。
        if (latest.id === message.id) conversation.hasUnreplied = true;
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
        contact: { ...contact, initialName: initialContactName(state, contact) },
        conversation,
        messages: state.messages.filter(item => item.conversationId === conversation.id)
          .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)),
        reminder: state.reminders.find(item => item.conversationId === conversation.id && item.status === 'pending') ?? null
      };
    }
  };
}
