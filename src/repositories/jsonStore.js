/*
単一プロセス用JSONストア。更新を直列化し、ファイル置換成功後にメモリを更新する。
*/
import * as fs from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { storageError } from '../utils/errors.js';

const emptyState = () => ({ version: 1, contacts: [], conversations: [], messages: [], reminders: [] });

function validateState(state) {
  if (!state || state.version !== 1 ||
      !['contacts', 'conversations', 'messages', 'reminders'].every(key =>
        Array.isArray(state[key]) && state[key].every(row => row && typeof row.id === 'string'))) {
    throw storageError();
  }
  for (const key of ['contacts', 'conversations', 'messages', 'reminders']) {
    if (new Set(state[key].map(row => row.id)).size !== state[key].length) throw storageError();
  }
  if (state.contacts.some(row => !['line', 'slack'].includes(row.platform) ||
      typeof row.displayName !== 'string' || typeof row.isFavorite !== 'boolean' ||
      !Number.isFinite(Date.parse(row.lastMessageAt)) ||
      !state.conversations.some(item => item.contactId === row.id)) ||
      state.conversations.some(row => !state.contacts.some(item => item.id === row.contactId) ||
        typeof row.hasUnreplied !== 'boolean' ||
        !state.messages.some(item => item.id === row.lastMessageId && item.conversationId === row.id)) ||
      state.messages.some(row => !state.conversations.some(item => item.id === row.conversationId) ||
        !Number.isFinite(Date.parse(row.timestamp))) ||
      state.reminders.some(row => !['pending', 'done', 'cancelled'].includes(row.status) ||
        !Number.isFinite(Date.parse(row.remindAt)) ||
        !state.messages.some(item => item.id === row.messageId && item.conversationId === row.conversationId))) {
    throw storageError();
  }
}

export async function createJsonStore(filePath, { io = fs } = {}) {
  let state;
  try {
    state = JSON.parse(await io.readFile(filePath, 'utf8'));
    validateState(state);
  } catch (error) {
    if (error.code === 'ENOENT') state = emptyState();
    else throw storageError();
  }
  let queue = Promise.resolve();
  return {
    read() { return structuredClone(state); },
    update(mutator) {
      const operation = queue.then(async () => {
        const draft = structuredClone(state);
        const result = await mutator(draft);
        validateState(draft);
        const temp = `${filePath}.${randomUUID()}.tmp`;
        try {
          await io.mkdir(dirname(filePath), { recursive: true });
          await io.writeFile(temp, JSON.stringify(draft, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
          await io.rename(temp, filePath);
        } catch {
          await io.unlink(temp).catch(() => {});
          throw storageError();
        }
        state = draft;
        return structuredClone(result);
      });
      queue = operation.catch(() => {});
      return operation;
    }
  };
}
