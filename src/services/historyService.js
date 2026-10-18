/* 履歴の参照を先に確定し、画像ファイルはその後に削除する。単一Backend用。 */
import { AppError, invalidInput, notFound } from '../utils/errors.js';
import { logEvent } from '../utils/logger.js';
export const RETENTION_DAYS = 30;
const HOUR = 60 * 60 * 1000;
export function createHistoryService(store, media, replies, { now = Date.now, intervalMs = HOUR } = {}) {
  let timer, running = false;
  async function remove(contactId, expected, cutoff, complete = false) {
    const conversation = store.read().conversations.find(c => c.contactId === contactId);
    if (!conversation) throw notFound();
    return replies.withConversationLock(conversation.id, async () => {
      const result = await store.update(state => {
        const c = state.conversations.find(c => c.contactId === contactId);
        if (!c) throw notFound();
        const history = state.messages.filter(m => m.conversationId === c.id);
        if (expected && (c.lastMessageId !== expected.lastMessageId || history.length !== expected.messageCount))
          throw new AppError(409, 'CONVERSATION_CHANGED', '履歴が更新されています。確認してから削除してください。');
        const removed = history.filter(m => cutoff === undefined || Date.parse(m.timestamp) <= cutoff);
        const ids = new Set(removed.map(m => m.id));
        state.messages = state.messages.filter(m => !ids.has(m.id));
        state.reminders = state.reminders.filter(r => !ids.has(r.messageId));
        // 送信待ち予約は保持する。完了した予約の本文も保存期限に従う。
        if (state.scheduledMessages) state.scheduledMessages = state.scheduledMessages.filter(j =>
          j.conversationId !== c.id || !complete && ['pending','sending'].includes(j.status) ||
          (cutoff !== undefined && Date.parse(j.sendAt) > cutoff));
        const remaining = state.messages.filter(m => m.conversationId === c.id);
        const latest = remaining.reduce((a,b) => !a || Date.parse(b.timestamp) >= Date.parse(a.timestamp) ? b : a, null);
        c.lastMessageId = latest?.id ?? null;
        if (!latest) c.hasUnreplied = false;
        const contact = state.contacts.find(p => p.id === contactId);
        if (latest) { c.updatedAt = latest.timestamp; contact.lastMessageAt = latest.timestamp; }
        if (complete) {
          state.contacts = state.contacts.filter(p => p.id !== contactId);
          state.conversations = state.conversations.filter(row => row.id !== c.id);
          for (const tab of state.tabs ?? []) tab.contactIds = tab.contactIds.filter(id => id !== contactId);
        }
        const referenced = new Set(state.messages.map(m => m.media?.id).filter(Boolean));
        return { deletedMessages: removed.length, mediaIds: [...new Set(removed.map(m => m.media?.id).filter(id => id && !referenced.has(id)))] };
      });
      let cleanupPending = false;
      for (const id of result.mediaIds) {
        try { await media.remove(id); } catch { cleanupPending = true; logEvent('MEDIA_CLEANUP_FAILED'); }
      }
      return { deletedMessages: result.deletedMessages, cleanupPending };
    });
  }
  const service = {
    clear(contactId, input, complete = false) {
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 2 ||
          !(input.lastMessageId === null || typeof input.lastMessageId === 'string' && input.lastMessageId) ||
          !Number.isInteger(input.messageCount) || input.messageCount < 0) throw invalidInput();
      return remove(contactId, input, undefined, complete);
    },
    async run() {
      if (running) return;
      running = true;
      try {
        const cutoff = now() - RETENTION_DAYS * 24 * HOUR;
        const state = store.read();
        const targets = new Set(state.messages.filter(m => Date.parse(m.timestamp) <= cutoff).map(m => m.conversationId));
        for (const j of state.scheduledMessages ?? []) if (!['pending','sending'].includes(j.status) && Date.parse(j.sendAt) <= cutoff) targets.add(j.conversationId);
        for (const c of state.conversations.filter(c => targets.has(c.id))) {
          try { await remove(c.contactId, undefined, cutoff); }
          catch (e) { if (e.code !== 'REPLY_IN_PROGRESS') throw e; }
        }
        // 保存失敗・通信失敗で残った画像も回収。受信・送信中の画像には24時間の猶予を設ける。
        await media.pruneOrphans(() => new Set(store.read().messages.map(m => m.media?.id).filter(Boolean)), now() - 24 * HOUR);
      } finally { running = false; }
    },
    start() {
      if (timer) return;
      service.run().catch(() => logEvent('HISTORY_CLEANUP_FAILED'));
      timer = setInterval(() => service.run().catch(() => logEvent('HISTORY_CLEANUP_FAILED')), intervalMs);
      timer.unref?.();
    },
    stop() { clearInterval(timer); timer = undefined; }
  };
  return service;
}
