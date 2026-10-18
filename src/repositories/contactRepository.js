/*
Contactのお気に入りを永続化し、関連する会話・最終メッセージを共通形式で取得する。
*/
import { initialContactName } from './contactName.js';
import { AppError, notFound } from '../utils/errors.js';

export function createContactRepository(store) {
  return {
    rename(contactId, name) {
      return store.update(state => {
        const contact = state.contacts.find(row => row.id === contactId);
        if (!contact) throw notFound();
        contact.initialName = initialContactName(state, contact);
        contact.displayName = name || contact.initialName;
        contact.nameOverridden = Boolean(name);
        return contact;
      });
    },
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
      return store.readIndexed((state,index) => state.contacts.map(contact => {
        const conversation = index.conversationByContactId.get(contact.id);
        if (!conversation) throw new Error('Missing conversation');
        return {
          contact: { ...contact, initialName: index.initialNameByContact.get(contact.id) },
          conversation,
          lastMessage: index.messagesById.get(conversation.lastMessageId) ?? null,
          reminder: index.pendingReminderByConversation.get(conversation.id) ?? null
        };
      }));
    }
  };
}
