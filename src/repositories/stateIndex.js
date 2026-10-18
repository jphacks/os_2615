/* 保存済みスナップショット専用。行オブジェクトを参照し、本文を複製しない。 */
export function createStateIndex(state) {
  const contactsById = new Map(state.contacts.map(contact => [contact.id, contact]));
  const conversationsById = new Map(state.conversations.map(conversation => [conversation.id, conversation]));
  const conversationByContactId = new Map(state.conversations.map(conversation => [conversation.contactId, conversation]));
  const messagesById = new Map();
  const messagesByConversation = new Map();
  for (const message of state.messages) {
    messagesById.set(message.id, message);
    let messages = messagesByConversation.get(message.conversationId);
    if (!messages) {
      messages = [];
      messagesByConversation.set(message.conversationId, messages);
    }
    messages.push(message);
  }
  for (const messages of messagesByConversation.values()) {
    messages.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  }
  const pendingReminderByConversation = new Map();
  for (const reminder of state.reminders) {
    if (reminder.status === 'pending' && !pendingReminderByConversation.has(reminder.conversationId)) {
      pendingReminderByConversation.set(reminder.conversationId, reminder);
    }
  }
  const initialNameByContact = new Map();
  for (const contact of state.contacts) {
    const conversation = conversationByContactId.get(contact.id);
    const firstIncoming = contact.nameOverridden
      ? (messagesByConversation.get(conversation?.id) ?? []).find(message => !message.isFromMe && message.senderName?.trim())
      : null;
    initialNameByContact.set(contact.id, contact.initialName || firstIncoming?.senderName || contact.displayName);
  }
  return { contactsById, conversationsById, conversationByContactId, messagesById,
    messagesByConversation, pendingReminderByConversation, initialNameByContact };
}
