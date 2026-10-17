/*
Contactに紐づく共通会話履歴を取得する。
*/
export function createMessageRepository(store) {
  return {
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
