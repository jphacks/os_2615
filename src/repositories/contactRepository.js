/*
Contactのお気に入りを永続化し、関連する会話・最終メッセージを共通形式で取得する。
*/
import { AppError, notFound } from '../utils/errors.js';

export function createContactRepository(store) {
  return {
    complete(contactId, lastMessageId) {
      return store.update(state => {
        const conversation = state.conversations.find(item => item.contactId === contactId);
        if (!conversation) throw notFound();
        if (conversation.lastMessageId !== lastMessageId) throw new AppError(409, 'CONVERSATION_CHANGED', '新しいメッセージが届いています。内容を確認してから対応済みにしてください。');
        conversation.hasUnreplied = false;
        for (const reminder of state.reminders) {
          if (reminder.conversationId === conversation.id && reminder.status === 'pending') reminder.status = 'done';
        }
        return conversation;
      });
    },
    setSearchName(contactId, searchName) {
      return store.update(state => {
        const contact = state.contacts.find(item => item.id === contactId);
        if (!contact) throw notFound();
        contact.searchName = searchName;
        return contact;
      });
    },
    setFavorite(contactId, isFavorite) {
      return store.update(state => {
        const contact = state.contacts.find(item => item.id === contactId);
        if (!contact) throw notFound();
        contact.isFavorite = isFavorite;
        return contact;
      });
    },
    listInbox() {
      const state = store.read();
      return state.contacts.map(contact => {
        const conversation = state.conversations.find(item => item.contactId === contact.id);
        if (!conversation) throw new Error('Missing conversation');
        return {
          contact,
          conversation,
          lastMessage: state.messages.find(item => item.id === conversation.lastMessageId) ?? null,
          reminder: state.reminders.find(item => item.conversationId === conversation.id && item.status === 'pending') ?? null
        };
      });
    }
  };
}
