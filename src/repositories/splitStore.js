/*
共通状態のAPIを保ち、メッセージをサービス・Contactごとのファイルへ分割する。
変更した履歴を先に保存し、管理ファイルのrenameを更新の確定点とする。
単一Backendプロセスで使う。メモリ上では既存と同じ共通状態を扱う。
*/
import * as fs from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createJsonStore } from './jsonStore.js';
import { storageError } from '../utils/errors.js';

const digest = text => createHash('sha256').update(text).digest('hex');
const folder = id => /^[A-Za-z0-9_-]+$/.test(id) ? id : `id-${Buffer.from(id).toString('base64url')}`;
const fileFor = (platform, contactId, content) => `${platform}/${folder(contactId)}/messages-${digest(content)}.json`;

export async function createSplitStore(filePath, { io = fs } = {}) {
  const root = dirname(filePath);
  let committed = [];
  let legacy = null;
  const pending = new Map();
  const adapter = {
    ...io,
    async readFile(path, encoding) {
      const text = await io.readFile(path, encoding);
      let index;
      try {
        index = JSON.parse(text);
        if (index.storageFormat === undefined) { legacy = text; return text; }
        if (index.storageFormat !== 'contacts-v1' || !Array.isArray(index.messageFiles) ||
            !Array.isArray(index.messageOrder) || Object.hasOwn(index, 'messages')) throw storageError();
        const messages = [];
        const seenContacts = new Set();
        for (const ref of index.messageFiles) {
          if (!ref || !['line', 'slack'].includes(ref.platform) || typeof ref.contactId !== 'string' ||
              typeof ref.file !== 'string' || seenContacts.has(ref.contactId)) throw storageError();
          seenContacts.add(ref.contactId);
          if (!index.contacts.some(contact => contact.id === ref.contactId && contact.platform === ref.platform)) throw storageError();
          // 管理ファイル内の任意パスを読まない。
          const prefix = `${ref.platform}/${folder(ref.contactId)}/messages-`;
          if (!ref.file.startsWith(prefix) || !/^[a-f0-9]{64}\.json$/.test(ref.file.slice(prefix.length))) throw storageError();
          const content = await io.readFile(join(root, ref.file), 'utf8');
          if (fileFor(ref.platform, ref.contactId, content) !== ref.file) throw storageError();
          const rows = JSON.parse(content);
          if (!Array.isArray(rows) || rows.some(message => message.platform !== ref.platform ||
              !index.conversations.some(conversation => conversation.id === message.conversationId && conversation.contactId === ref.contactId))) throw storageError();
          messages.push(...rows);
        }
        const byId = new Map(messages.map(message => [message.id, message]));
        if (byId.size !== messages.length || index.messageOrder.length !== messages.length ||
            new Set(index.messageOrder).size !== messages.length || index.messageOrder.some(id => !byId.has(id))) throw storageError();
        committed = index.messageFiles;
        const { storageFormat, messageFiles, messageOrder, ...state } = index;
        return JSON.stringify({ ...state, messages: messageOrder.map(id => byId.get(id)) });
      } catch { throw storageError(); }
    },
    async writeFile(temp, text, options) {
      const state = JSON.parse(text);
      const groups = new Map();
      const conversations = new Map(state.conversations.map(conversation => [conversation.id, conversation]));
      const contacts = new Map(state.contacts.map(contact => [contact.id, contact]));
      for (const message of state.messages) {
        const conversation = conversations.get(message.conversationId);
        const contact = contacts.get(conversation?.contactId);
        if (!contact || !['line', 'slack'].includes(contact.platform) || message.platform !== contact.platform) throw storageError();
        if (!groups.has(contact.id)) groups.set(contact.id, { contact, messages: [] });
        groups.get(contact.id).messages.push(message);
      }
      const refs = [];
      const created = [];
      pending.set(temp, { refs, created });
      for (const { contact, messages } of groups.values()) {
        const content = JSON.stringify(messages, null, 2) + '\n';
        const file = fileFor(contact.platform, contact.id, content);
        const path = join(root, file);
        if (!committed.some(ref => ref.file === file)) {
          await io.mkdir(dirname(path), { recursive: true });
          try {
            await io.writeFile(path, content, { flag: 'wx', mode: 0o600 });
            created.push(path);
          } catch (error) {
            // 起動前の異常終了で残った同じ内容のファイルなら再利用できる。
            if (error.code !== 'EEXIST' || await io.readFile(path, 'utf8') !== content) throw error;
          }
        }
        refs.push({ platform: contact.platform, contactId: contact.id, file });
      }
      const { messages, ...index } = state;
      await io.writeFile(temp, JSON.stringify({ ...index, storageFormat: 'contacts-v1',
        messageFiles: refs, messageOrder: messages.map(message => message.id) }, null, 2) + '\n', options);
    },
    async rename(temp, destination) {
      await io.rename(temp, destination);
      const { refs } = pending.get(temp);
      const old = committed;
      committed = refs;
      pending.delete(temp);
      // 失敗しても確定済みの保存は取り消さない。不要ファイルが残るだけ。
      for (const ref of old) if (!refs.some(current => current.file === ref.file)) {
        await io.unlink(join(root, ref.file)).catch(() => {});
      }
    },
    async unlink(temp) {
      const work = pending.get(temp);
      pending.delete(temp);
      if (work) for (const path of work.created) await io.unlink(path).catch(() => {});
      return io.unlink(temp);
    }
  };
  const store = await createJsonStore(filePath, { io: adapter });
  if (legacy !== null) {
    // 検証済みの旧形式を退避してから初回移行。旧ファイルは切替成功まで維持する。
    await io.writeFile(join(root, `store.legacy-${randomUUID()}.json`), legacy, { flag: 'wx', mode: 0o600 })
      .catch(() => { throw storageError(); });
    await store.update(() => null);
  }
  return store;
}
