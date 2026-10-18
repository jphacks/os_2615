/* 旧データは最初の受信名から補完する。初期名がない場合も空文字にはしない。 */
export function initialContactName(state, contact) {
  if (contact.initialName) return contact.initialName;
  if (contact.nameOverridden) {
    const conversation = state.conversations.find(c => c.contactId === contact.id);
    const first = state.messages.filter(m => m.conversationId === conversation?.id && !m.isFromMe && m.senderName?.trim())
      .sort((a,b) => Date.parse(a.timestamp)-Date.parse(b.timestamp))[0];
    if (first) return first.senderName;
  }
  return contact.displayName;
}
