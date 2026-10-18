/* 通知先・VAPID秘密鍵はGit管理外に保存。本文・人物名は通知事業者へ送らない。 */
import * as fs from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import webpush from 'web-push';
import { invalidInput } from '../utils/errors.js';
import { logEvent } from '../utils/logger.js';

export function validateSubscription(value) {
  if (!value || typeof value.endpoint !== 'string' || value.endpoint.length > 4096) throw invalidInput();
  let url;
  try { url = new URL(value.endpoint); } catch { throw invalidInput(); }
  const host = url.hostname;
  const allowed = host === 'fcm.googleapis.com' || host === 'updates.push.services.mozilla.com' ||
    host === 'web.push.apple.com' || /^[a-z0-9-]+\.push\.apple\.com$/.test(host) ||
    host === 'wns.windows.com' || /^[a-z0-9-]+\.notify\.windows\.com$/.test(host);
  if (!allowed || url.protocol !== 'https:' || url.port || url.username || url.password || url.hash) throw invalidInput();
  const keys = value.keys;
  if (!keys || !/^[A-Za-z0-9_-]{87}$/.test(keys.p256dh) || !/^[A-Za-z0-9_-]{22}$/.test(keys.auth) ||
      Buffer.from(keys.p256dh, 'base64url')[0] !== 4) throw invalidInput();
  return { endpoint: url.href, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

export async function createPushService(store, filePath, { send = webpush.sendNotification, now = Date.now } = {}) {
  let state;
  try {
    state = JSON.parse(await fs.readFile(filePath, 'utf8'));
    if (state.version !== 1 || !state.vapid?.publicKey || !state.vapid?.privateKey || !Array.isArray(state.subscriptions)) throw new Error('Invalid push storage');
    for (const row of state.subscriptions) {
      validateSubscription(row.subscription);
      if (!row.receipts || typeof row.receipts !== 'object' || Array.isArray(row.receipts)) throw new Error('Invalid receipts');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    state = { version: 1, vapid: webpush.generateVAPIDKeys(), subscriptions: [] };
    await persist(state);
  }
  async function persist(draft) {
    await fs.mkdir(dirname(filePath), { recursive: true });
    const temp = `${filePath}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify(draft), { mode: 0o600, flag: 'wx' });
      await fs.rename(temp, filePath);
    } finally { await fs.unlink(temp).catch(() => {}); }
  }
  let queue = Promise.resolve();
  function update(fn) {
    const task = queue.then(async () => {
      const draft = structuredClone(state);
      const result = await fn(draft);
      await persist(draft);
      state = draft;
      return result;
    });
    queue = task.catch(() => {});
    return task;
  }
  function events() {
    return store.readIndexed((_state, index) => {
      const result = [];
      for (const messages of index.messagesByConversation.values()) {
        const message = messages.findLast(item => !item.isFromMe);
        if (message) result.push({ key: `message:${message.id}`, at: Date.parse(message.timestamp), kind: 'message' });
      }
      for (const reminder of index.pendingReminderByConversation.values()) {
        const at = Date.parse(reminder.remindAt);
        if (at <= now()) result.push({ key: `reminder:${reminder.id}:${reminder.remindAt}`, at, kind: 'reminder' });
      }
      return result.filter(item => item.at > now() - 86400000 && item.at <= now());
    });
  }
  function notify(subscription, kind, key) {
    return send(subscription, JSON.stringify({
      title: kind === 'reminder' ? 'こねくと：返信の時間です' : 'こねくと：新着メッセージ',
      body: kind === 'reminder' ? '「後で返信」に設定した会話を確認してください。' : '新しいメッセージが届きました。',
      tag: kind === 'reminder' ? key : 'konekuto-new-message'
    }), { TTL: 3600, timeout: 10000, urgency: 'normal',
      vapidDetails: { subject: process.env.WEB_PUSH_SUBJECT || 'https://github.com/jphacks/os_2615', ...state.vapid } });
  }
  let timer, stopped = true, running = false;
  const service = {
    publicKey: state.vapid.publicKey,
    subscribe(value) {
      const subscription = validateSubscription(value);
      return update(draft => {
        const existing = draft.subscriptions.find(row => row.subscription.endpoint === subscription.endpoint);
        if (existing) { existing.subscription = subscription; return; }
        if (draft.subscriptions.length >= 200) throw invalidInput();
        // 登録前の履歴を新着として通知しない。
        draft.subscriptions.push({ subscription, receipts: Object.fromEntries(events().map(event => [event.key, now()])) });
      });
    },
    unsubscribe(value) {
      const subscription = validateSubscription(value);
      return update(draft => { draft.subscriptions = draft.subscriptions.filter(row => row.subscription.endpoint !== subscription.endpoint || row.subscription.keys.auth !== subscription.keys.auth); });
    },
    async test(value) {
      const subscription = validateSubscription(value);
      await queue;
      if (!state.subscriptions.some(row => row.subscription.endpoint === subscription.endpoint && row.subscription.keys.auth === subscription.keys.auth)) throw invalidInput();
      await notify(subscription, 'message', 'test');
    },
    async tick() {
      if (running) return;
      running = true;
      try {
        await queue;
        if (!state.subscriptions.length) return;
        const candidates = events();
        for (const row of [...state.subscriptions]) {
          for (const event of candidates) {
            if (row.receipts[event.key]) continue;
            try {
              await notify(row.subscription, event.kind, event.key);
              await update(draft => {
                const current = draft.subscriptions.find(item => item.subscription.endpoint === row.subscription.endpoint);
                if (current) {
                  current.receipts[event.key] = now();
                  for (const [key, time] of Object.entries(current.receipts)) if (time < now() - 2 * 86400000) delete current.receipts[key];
                }
              });
            } catch (error) {
              if (error.statusCode === 404 || error.statusCode === 410) await service.unsubscribe(row.subscription);
              else logEvent('PUSH_DELIVERY_FAILED');
              break;
            }
          }
        }
      } finally { running = false; }
    },
    start() {
      if (!stopped) return;
      stopped = false;
      const run = async () => {
        try { await service.tick(); } catch { logEvent('PUSH_PROCESS_FAILED'); }
        if (!stopped) timer = setTimeout(run, 10000);
      };
      void run();
    },
    stop() { stopped = true; clearTimeout(timer); }
  };
  return service;
}
