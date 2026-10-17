/*
Providerが返す共通の送信結果を検証し、保存するMessageを生成する。
*/
import { randomUUID } from 'node:crypto';
import { invalidInput } from '../utils/errors.js';

export function createSentMessage(draft, conversationId) {
  if (!draft || !['line', 'slack'].includes(draft.platform) || draft.messageType !== 'text' ||
      draft.isFromMe !== true || typeof conversationId !== 'string' || !conversationId ||
      !['platformMessageId', 'senderId', 'text', 'timestamp'].every(key => typeof draft[key] === 'string' && draft[key]) ||
      !Number.isFinite(Date.parse(draft.timestamp)) || !draft.metadata ||
      typeof draft.metadata !== 'object' || Array.isArray(draft.metadata)) throw invalidInput();
  return {
    id: randomUUID(), platform: draft.platform, messageType: 'text',
    platformMessageId: draft.platformMessageId, senderId: draft.senderId, senderName: '自分',
    conversationId, text: draft.text, timestamp: new Date(draft.timestamp).toISOString(),
    isFromMe: true, metadata: structuredClone(draft.metadata)
  };
}
