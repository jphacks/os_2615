/*
LINEの表示名取得とPush返信を担当する。Token・外部エラー本文は外へ出さない。
*/
import { AppError, deliveryUnknown, invalidInput, providerError } from '../../utils/errors.js';
import { MAX_IMAGE_BYTES } from '../../repositories/mediaRepository.js';
import { mapLineSentMessage } from './lineMapper.js';

export function createLineClient({ accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN, fetchImpl = fetch } = {}) {
  const names = new Map();
  let botUserId;
  const requireToken = () => {
    if (!accessToken?.trim()) throw new AppError(503, 'PROVIDER_NOT_CONFIGURED', 'LINEの認証情報が未設定です。');
  };
  async function getBotUserId() {
    if (botUserId) return botUserId;
    try {
      const response = await fetchImpl('https://api.line.me/v2/bot/info', {
        headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(5000)
      });
      if (!response.ok) throw new Error('Bot profile failed');
      const info = await response.json();
      if (typeof info.userId !== 'string' || !info.userId) throw new Error('Invalid bot profile');
      botUserId = info.userId;
      return botUserId;
    } catch { throw providerError(); }
  }
  return {
    async getImage(messageId) {
      requireToken();
      try {
        const response = await fetchImpl(`https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`, {
          headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10000), redirect: 'error'
        });
        if (!response.ok || Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) throw new Error('Content unavailable');
        const reader = response.body.getReader();
        let size = 0; const chunks = [];
        try {
          while (true) {
            const { done, value } = await reader.read(); if (done) break;
            size += value.byteLength;
            if (size > MAX_IMAGE_BYTES) { await reader.cancel(); throw new Error('Content too large'); }
            chunks.push(Buffer.from(value));
          }
        } finally { reader.releaseLock(); }
        return Buffer.concat(chunks);
      } catch { throw new AppError(502, 'PROVIDER_ERROR', 'LINE画像を取得できませんでした。'); }
    },
    async sendImage({ conversation, contact, media, publicBaseUrl }) {
      if (conversation.platform !== 'line' || contact.platform !== 'line' ||
          conversation.platformConversationId !== contact.platformUserId || !/^U[0-9a-f]{32}$/i.test(contact.platformUserId)) throw invalidInput();
      requireToken();
      const senderId = await getBotUserId();
      const url = `${publicBaseUrl}/media/${media.id}`;
      let response;
      try {
        response = await fetchImpl('https://api.line.me/v2/bot/message/push', {
          method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: contact.platformUserId, messages: [{ type: 'image', originalContentUrl: url, previewImageUrl: url }] }),
          signal: AbortSignal.timeout(5000)
        });
      } catch { throw deliveryUnknown(); }
      if (!response.ok) {
        if (response.status >= 500 || response.status === 408) throw deliveryUnknown();
        throw providerError();
      }
      try { return { ...mapLineSentMessage(await response.json(), { senderId, text: '[画像]' }), messageType: 'image', media }; }
      catch { throw deliveryUnknown(); }
    },
    async sendText({ conversation, contact, text }) {
      if (conversation.platform !== 'line' || contact.platform !== 'line' ||
          conversation.platformConversationId !== contact.platformUserId ||
          !/^U[0-9a-f]{32}$/i.test(contact.platformUserId)) throw invalidInput();
      requireToken();
      // 送信前に公式アカウントIDを解決する。失敗時はPushを実行しない。
      const senderId = await getBotUserId();
      let response;
      try {
        response = await fetchImpl('https://api.line.me/v2/bot/message/push', {
          method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: contact.platformUserId, messages: [{ type: 'text', text }] }),
          signal: AbortSignal.timeout(5000)
        });
      } catch { throw deliveryUnknown(); }
      if (!response.ok) {
        if (response.status >= 500 || response.status === 408) throw deliveryUnknown();
        throw providerError();
      }
      try { return mapLineSentMessage(await response.json(), { senderId, text }); }
      catch { throw deliveryUnknown(); }
    },
    async getDisplayName(userId) {
      if (names.has(userId)) return names.get(userId);
      requireToken();
      try {
        const response = await fetchImpl(`https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`, {
          headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(1500)
        });
        if (!response.ok) throw new Error('Profile request failed');
        const profile = await response.json();
        if (typeof profile.displayName !== 'string' || !profile.displayName.trim()) throw new Error('Invalid profile');
        names.set(userId, profile.displayName);
        return profile.displayName;
      } catch {
        throw new AppError(502, 'PROVIDER_ERROR', 'LINEプロフィールを取得できませんでした。');
      }
    }
  };
}
