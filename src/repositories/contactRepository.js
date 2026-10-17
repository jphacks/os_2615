/*
Contactと関連する会話・最終メッセージを共通形式で取得する。
*/
export function createContactRepository(store) {
  return {
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
