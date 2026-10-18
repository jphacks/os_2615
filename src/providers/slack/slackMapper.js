/*
人からBotに届いた1対1のSlack DMだけを共通受信データへ変換する。
*/
import { invalidInput } from '../../utils/errors.js';

function timestampFromTs(ts) {
  if (typeof ts !== 'string' || !/^\d{1,12}\.\d{1,6}$/.test(ts)) throw invalidInput();
  const [seconds, fraction] = ts.split('.');
  return new Date(Number(seconds) * 1000 + Number(fraction.padEnd(3, '0').slice(0, 3))).toISOString();
}

export function mapSlackEvent(event, { teamId, botUserId, eventId, displayName = null } = {}) {
  if (event?.type !== 'message' || event.channel_type !== 'im' || (event.subtype && !(event.subtype === 'file_share' && Array.isArray(event.files) && event.files.length)) ||
      event.bot_id || event.bot_profile || event.user === botUserId) return null;
  if (typeof event.channel !== 'string' || !event.channel.startsWith('D')) return null;
  if (typeof teamId !== 'string' || !teamId || typeof botUserId !== 'string' || !botUserId ||
      typeof event.user !== 'string' || !event.user || typeof event.ts !== 'string' ||
      !/^\d{1,12}\.\d{1,6}$/.test(event.ts)) throw invalidInput();
  const timestamp = timestampFromTs(event.ts);
  const name = typeof displayName === 'string' && displayName.trim() ? displayName : null;
  const metadata = { teamId };
  if (typeof eventId === 'string') metadata.eventId = eventId;
  if (typeof event.thread_ts === 'string') metadata.threadTs = event.thread_ts;
  const hasText = typeof event.text === 'string' && event.text.length > 0;
  return {
    platform: 'slack', platformUserId: `${teamId}:${event.user}`,
    platformConversationId: event.channel, displayName: name,
    message: {
      platform: 'slack', messageType: hasText ? 'text' : 'other', platformMessageId: event.ts,
      senderId: event.user, senderName: name ?? `Slackユーザー (${event.user})`,
      text: hasText ? event.text : '[未対応のメッセージ]', timestamp, isFromMe: false, metadata
    }
  };
}

export function mapSlackSentMessage(response, { teamId, botUserId, text }) {
  return {
    platform: 'slack', messageType: 'text', platformMessageId: response.ts,
    senderId: botUserId, senderName: '自分', text, timestamp: timestampFromTs(response.ts),
    isFromMe: true, metadata: { teamId }
  };
}
