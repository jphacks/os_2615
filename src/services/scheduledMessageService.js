/* 単一Backend用の予約送信。送信前に状態を確定し、不明な送信を再実行しない。 */
import { AppError, invalidInput, notFound } from '../utils/errors.js';
import { logEvent } from '../utils/logger.js';
export const MAX_SCHEDULE_AHEAD_MS = 14 * 24 * 60 * 60 * 1000;
export function createScheduledMessageService(store, replies, { now = Date.now, intervalMs = 1000 } = {}) {
  let timer, running = false, stopped = true;
  const service = {
    list(conversationId) {
      if (conversationId !== undefined && (typeof conversationId !== 'string' || !conversationId)) throw invalidInput();
      return (store.read().scheduledMessages ?? []).filter(job => !conversationId || job.conversationId === conversationId)
        .sort((a,b) => Date.parse(a.sendAt) - Date.parse(b.sendAt));
    },
    create(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 4 ||
          typeof input.conversationId !== 'string' || !input.conversationId || typeof input.text !== 'string' ||
          !input.text.trim() || input.text.length > 5000 || typeof input.sendAt !== 'string' ||
          !Number.isFinite(Date.parse(input.sendAt)) || Date.parse(input.sendAt) <= now() ||
          typeof input.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)) throw invalidInput();
      if (Date.parse(input.sendAt) > now() + MAX_SCHEDULE_AHEAD_MS)
        throw new AppError(400, 'VALIDATION_ERROR', '予約できる日時は現在から14日後までです。');
      return store.update(state => {
        const conversation = state.conversations.find(row => row.id === input.conversationId);
        if (!conversation) throw notFound();
        const jobs = state.scheduledMessages ??= [];
        const existing = jobs.find(job => job.id === input.requestId);
        const sendAt = new Date(input.sendAt).toISOString();
        if (existing) {
          if (existing.conversationId !== input.conversationId || existing.text !== input.text || existing.sendAt !== sendAt)
            throw new AppError(409, 'SCHEDULE_CONFLICT', '同じ予約IDで異なる内容は保存できません。');
          return existing;
        }
        const job = { id: input.requestId, conversationId: conversation.id, text: input.text,
          sendAt, status: 'pending', createdAt: new Date(now()).toISOString() };
        jobs.push(job); return job;
      });
    },
    cancel(id) {
      return store.update(state => {
        const job = (state.scheduledMessages ?? []).find(row => row.id === id);
        if (!job) throw notFound();
        if (job.status === 'cancelled') return job;
        if (job.status !== 'pending') throw new AppError(409, 'SCHEDULE_STARTED', '送信開始後の予約は取り消せません。送信状態を確認してください。');
        job.status = 'cancelled'; return job;
      });
    },
    async recover() {
      const jobs = store.read().scheduledMessages ?? [];
      if (!jobs.some(job => job.status === 'sending' || job.status === 'pending' && Date.parse(job.sendAt) <= now())) return;
      await store.update(state => {
        for (const job of state.scheduledMessages ?? []) {
          if (job.status === 'sending') job.status = 'unknown';
          else if (job.status === 'pending' && Date.parse(job.sendAt) <= now()) job.status = 'missed';
        }
      });
    },
    async runDue() {
      if (running) return;
      running = true;
      try {
        const due = service.list().filter(job => job.status === 'pending' && Date.parse(job.sendAt) <= now());
        for (const candidate of due) {
          if (stopped && timer) break;
          const job = await store.update(state => {
            const current = (state.scheduledMessages ?? []).find(row => row.id === candidate.id);
            if (current?.status !== 'pending') return null;
            if (now() - Date.parse(current.sendAt) > 5 * 60000) { current.status = 'missed'; return null; }
            current.status = 'sending'; return structuredClone(current);
          });
          if (!job) continue;
          try { await replies.replyScheduled(job); }
          catch (error) {
            const definite = ['PROVIDER_NOT_CONFIGURED', 'PROVIDER_ERROR', 'VALIDATION_ERROR', 'NOT_FOUND', 'REPLY_IN_PROGRESS'];
            await store.update(state => {
              const current = state.scheduledMessages.find(row => row.id === job.id);
              if (current?.status === 'sending') current.status = definite.includes(error?.code) ? 'failed' : 'unknown';
            });
          }
        }
      } finally { running = false; }
    },
    async start() {
      if (!stopped) return;
      stopped = false;
      try { await service.recover(); }
      catch(error) { stopped = true; throw error; }
      if (stopped) return;
      timer = setInterval(() => { service.runDue().catch(() => logEvent('SCHEDULE_PROCESS_FAILED')); }, intervalMs);
      timer.unref?.();
    },
    stop() { stopped = true; clearInterval(timer); }
  };
  return service;
}
