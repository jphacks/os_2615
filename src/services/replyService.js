/*
保存済み会話から送信先を解決し、Provider送信成功後に履歴と返信状態を保存する。
*/
import { AppError, deliveryUnknown, invalidInput } from '../utils/errors.js';

export function createReplyService(repository, providers, { mediaRepository, publicBaseUrl = process.env.PUBLIC_BASE_URL } = {}) {
  const pending = new Set();
  return {
    async withConversationLock(id, operation) {
      if (pending.has(id)) throw new AppError(409, 'REPLY_IN_PROGRESS', 'この会話は送信・整理中です。少し待ってください。');
      pending.add(id);
      try { return await operation(); } finally { pending.delete(id); }
    },
    async reply(input) { return send(input, false); },
    async replyScheduled(job) { return send({ conversationId: job.conversationId, text: job.text }, false, job.id); },
    async replyImage(conversationId, bytes) { return send({ conversationId, bytes }, true); }
  };
  async function send(input, image, scheduledId) {
      if (!input || typeof input !== 'object' || Array.isArray(input) ||
          Object.keys(input).length !== 2 || Object.keys(input).some(key => !(image ? ['conversationId', 'bytes'] : ['conversationId', 'text']).includes(key)) ||
          typeof input.conversationId !== 'string' || !input.conversationId.trim() ||
          (image ? !Buffer.isBuffer(input.bytes) || !input.bytes.length || input.bytes.length > 1024 * 1024
            : typeof input.text !== 'string' || !input.text.trim() || input.text.length > 5000)) throw invalidInput();
      const { conversationId } = input;
      const text = image ? '[画像]' : input.text;
      if (pending.has(conversationId)) throw new AppError(409, 'REPLY_IN_PROGRESS', 'この会話へ送信中です。');
      pending.add(conversationId);
      try {
        const context = repository.getReplyContext(conversationId);
        const provider = Object.hasOwn(providers, context.conversation.platform) ? providers[context.conversation.platform] : null;
        if (image && context.conversation.platform !== 'line') throw invalidInput();
        if (!(image ? provider?.sendImage : provider?.sendText)) throw new AppError(503, 'PROVIDER_NOT_CONFIGURED', '送信サービスが未設定です。');
        let media, baseUrl;
        if (image) {
          try {
            const url = new URL(publicBaseUrl);
            if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
            baseUrl = url.origin;
          } catch { throw new AppError(503, 'PUBLIC_URL_REQUIRED', '画像送信用のHTTPS公開URLが未設定です。'); }
          media = await mediaRepository.save(input.bytes, context.conversation.platform, 1024 * 1024);
        }
        let draft;
        try { draft = image
          ? await provider.sendImage({ conversation: context.conversation, contact: context.contact, media, publicBaseUrl: baseUrl })
          : await provider.sendText({ conversation: context.conversation, contact: context.contact, text }); }
        catch (error) {
          if (error instanceof AppError) throw error;
          throw deliveryUnknown();
        }
        // ここからの失敗は外部送信済みの可能性がある。再送を促す一般保存エラーにはしない。
        try {
          if (draft?.text !== text || (image && (draft.messageType !== 'image' || draft.media?.id !== media.id))) throw new Error('Unexpected message text');
          return await repository.saveReply(context, draft, scheduledId);
        } catch { throw deliveryUnknown(500); }
      } finally { pending.delete(conversationId); }
    }
}
