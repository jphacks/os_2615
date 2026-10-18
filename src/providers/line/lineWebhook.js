/*
raw bodyのHMAC-SHA256署名をJSON解析前に検証し、共通受信処理へ渡す。
*/
import express, { Router } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError, invalidInput } from '../../utils/errors.js';
import { logEvent } from '../../utils/logger.js';
import { mapLineEvent } from './lineMapper.js';

export function verifyLineSignature(rawBody, signature, channelSecret) {
  if (!Buffer.isBuffer(rawBody) || typeof signature !== 'string') return false;
  const expected = createHmac('sha256', channelSecret).update(rawBody).digest('base64');
  const supplied = Buffer.from(signature, 'utf8');
  const digest = Buffer.from(expected, 'utf8');
  return supplied.length === digest.length && timingSafeEqual(supplied, digest);
}

export function createLineWebhookRouter(messages, {
  channelSecret = process.env.LINE_CHANNEL_SECRET,
  getDisplayName = async () => null,
  getImage, mediaRepository
} = {}) {
  const router = Router();
  // Content-Typeに関係なく同じバイト列を検証する。圧縮bodyも自動展開しない。
  router.post('/', express.raw({ type: () => true, limit: '1mb', inflate: false }), async (req, res) => {
    if (!channelSecret) throw new AppError(503, 'PROVIDER_NOT_CONFIGURED', 'LINEの署名検証設定が未設定です。');
    if (!verifyLineSignature(req.body, req.get('x-line-signature'), channelSecret)) {
      throw new AppError(401, 'INVALID_SIGNATURE', 'LINE署名を確認できませんでした。');
    }
    let body;
    try { body = JSON.parse(req.body.toString('utf8')); } catch { throw invalidInput(); }
    if (!body || !Array.isArray(body.events)) throw invalidInput();
    // 全イベントを先に検証し、不正なバッチの部分保存を避ける。
    const mapped = body.events.map(event => ({ event, incoming: mapLineEvent(event) })).filter(item => item.incoming);
    for (const { event, incoming } of mapped) {
      if (messages.isDuplicate(incoming)) continue;
      let name = null;
      try { name = await getDisplayName(incoming.platformUserId); }
      catch { logEvent('LINE_PROFILE_UNAVAILABLE'); }
      const normalized = name ? mapLineEvent(event, name) : incoming;
      if (normalized.message.messageType === 'image') {
        try {
          normalized.message.media = await mediaRepository.save(await getImage(normalized.message.platformMessageId), 'line');
        } catch (error) {
          if (!['IMAGE_TOO_LARGE', 'PAYLOAD_TOO_LARGE'].includes(error?.code)) throw error;
          normalized.message.messageType = 'other';
          normalized.message.text = '画像の受信上限（1MB）を超えたため保存できませんでした。';
          normalized.message.metadata = { ...normalized.message.metadata, imageRejected: 'too_large' };
        }
      }
      await messages.receive(normalized);
    }
    res.json({ ok: true });
  });
  return router;
}
