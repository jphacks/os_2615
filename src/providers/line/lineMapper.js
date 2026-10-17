/*
LINEの1対1イベントを共通受信データへ変換する。生JSONやreplyTokenは保存しない。
*/
import { invalidInput } from '../../utils/errors.js';

export function mapLineEvent(event, displayName = null) {
  if (event?.type !== 'message' || event.source?.type !== 'user') return null;
  const userId = event.source.userId;
  const message = event.message;
  if (typeof userId !== 'string' || !userId || typeof message?.id !== 'string' || !message.id ||
      typeof event.timestamp !== 'number' || !Number.isFinite(event.timestamp) ||
      !Number.isFinite(new Date(event.timestamp).getTime())) throw invalidInput();

  const metadata = {};
  if (typeof event.webhookEventId === 'string') metadata.webhookEventId = event.webhookEventId;
  let messageType = 'other';
  let text = '[未対応のメッセージ]';
  if (message.type === 'text') {
    if (typeof message.text !== 'string') throw invalidInput();
    messageType = 'text';
    text = message.text;
  } else if (message.type === 'sticker') {
    messageType = 'sticker';
    text = '[スタンプが送信されました]';
    for (const key of ['packageId', 'stickerId', 'stickerResourceType']) {
      if (typeof message[key] === 'string') metadata[key] = message[key];
    }
    metadata.keywords = Array.isArray(message.keywords) ? message.keywords.filter(word => typeof word === 'string') : [];
  } else if (typeof message.type === 'string') {
    metadata.originalType = message.type;
  }
  const name = typeof displayName === 'string' && displayName.trim() ? displayName : null;
  return {
    platform: 'line', platformUserId: userId, platformConversationId: userId, displayName: name,
    message: {
      platform: 'line', messageType, platformMessageId: message.id, senderId: userId,
      senderName: name ?? `LINEユーザー (${userId.slice(-6)})`, text,
      timestamp: new Date(event.timestamp).toISOString(), isFromMe: false, metadata
    }
  };
}
