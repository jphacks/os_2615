/*
保存済み会話から送信先を解決し、Provider送信成功後に履歴と返信状態を保存する。
*/
import { AppError, deliveryUnknown, invalidInput } from '../utils/errors.js';

export function createReplyService(repository, providers) {
  const pending = new Set();
  return {
    async reply(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input) ||
          Object.keys(input).length !== 2 || Object.keys(input).some(key => !['conversationId', 'text'].includes(key)) ||
          typeof input.conversationId !== 'string' || !input.conversationId.trim() ||
          typeof input.text !== 'string' || !input.text.trim() || input.text.length > 5000) throw invalidInput();
      const { conversationId, text } = input;
      if (pending.has(conversationId)) throw new AppError(409, 'REPLY_IN_PROGRESS', 'この会話へ送信中です。');
      pending.add(conversationId);
      try {
        const context = repository.getReplyContext(conversationId);
        const provider = Object.hasOwn(providers, context.conversation.platform) ? providers[context.conversation.platform] : null;
        if (!provider?.sendText) throw new AppError(503, 'PROVIDER_NOT_CONFIGURED', '送信サービスが未設定です。');
        let draft;
        try { draft = await provider.sendText({ conversation: context.conversation, contact: context.contact, text }); }
        catch (error) {
          if (error instanceof AppError) throw error;
          throw deliveryUnknown();
        }
        // ここからの失敗は外部送信済みの可能性がある。再送を促す一般保存エラーにはしない。
        try {
          if (draft?.text !== text) throw new Error('Unexpected message text');
          return await repository.saveReply(context, draft);
        } catch { throw deliveryUnknown(500); }
      } finally { pending.delete(conversationId); }
    }
  };
}
