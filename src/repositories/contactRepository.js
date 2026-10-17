/*
Contactのお気に入りを永続化し、関連する会話・最終メッセージを共通形式で取得する。
*/
import { notFound } from '../utils/errors.js';

export function createContactRepository(store) {
  return {
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
