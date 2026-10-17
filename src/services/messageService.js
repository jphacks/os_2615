/*
共通会話履歴の取得と受信データの検証・保存を担当する。Provider固有JSONは扱わない。
*/
import { invalidInput, notFound } from '../utils/errors.js';

function validateIncoming(incoming) {
  const message = incoming?.message;
  if (!incoming || !['line', 'slack'].includes(incoming.platform) ||
      !['platformUserId', 'platformConversationId'].every(key => typeof incoming[key] === 'string' && incoming[key]) ||
      !message || message.platform !== incoming.platform || message.isFromMe !== false ||
      !['text', 'sticker', 'image', 'other'].includes(message.messageType) ||
      !['platformMessageId', 'senderId', 'senderName'].every(key => typeof message[key] === 'string' && message[key]) ||
      typeof message.text !== 'string' || typeof message.timestamp !== 'string' ||
      !Number.isFinite(Date.parse(message.timestamp)) || !message.metadata ||
      typeof message.metadata !== 'object' || Array.isArray(message.metadata) ||
      !(incoming.displayName === null || (typeof incoming.displayName === 'string' && incoming.displayName.trim()))) {
    throw invalidInput();
  }
}

export function createMessageService(repository) {
  return {
    isDuplicate(incoming) {
      validateIncoming(incoming);
      return repository.isDuplicate(incoming);
    },
    receive(incoming) {
      validateIncoming(incoming);
      return repository.receive(incoming);
    },
    history(contactId) {
      const history = repository.findHistory(contactId);
      if (!history) throw notFound();
      return history;
    }
  };
}
