/*
会話ごとの保留中リマインダーを永続化し、取消・一覧取得を行う。
*/
import { randomUUID } from 'node:crypto';
import { AppError, invalidInput, notFound } from '../utils/errors.js';

export function createReminderRepository(store) {
  return {
    list() { return store.read().reminders; },
    save(input) {
      return store.update(state => {
        if (!state.conversations.some(item => item.id === input.conversationId)) throw notFound();
        const message = state.messages.find(item => item.id === input.messageId);
        if (!message) throw notFound();
        if (message.conversationId !== input.conversationId) throw invalidInput();
        let reminder = state.reminders.find(item => item.conversationId === input.conversationId && item.status === 'pending');
        const created = !reminder;
        if (created) {
          reminder = { id: randomUUID(), ...input, status: 'pending' };
          state.reminders.push(reminder);
        } else Object.assign(reminder, input);
        return { reminder, created };
      });
    },
    cancel(id) {
      return store.update(state => {
        const reminder = state.reminders.find(item => item.id === id);
        if (!reminder) throw notFound();
        if (reminder.status === 'done') throw new AppError(409, 'INVALID_STATE', '完了済みのリマインダーは取り消せません。');
        reminder.status = 'cancelled';
        return reminder;
      });
    }
  };
}
