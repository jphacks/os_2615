/*
管理API・LINE専用Webhookを別ポートで起動し、Slack Socket Modeも同じ保存層へ接続する。
*/
import 'dotenv/config';
import { isDemoMode, openDemoStore, createDemoProvider } from './demo/demoMode.js';
import { createPushService } from './services/pushService.js';
import { createPushRouter } from './routes/push.js';
import { createMediaRepository } from './repositories/mediaRepository.js';
import { createMediaRouter } from './routes/media.js';
import { createTabRepository } from './repositories/tabRepository.js';
import { createTabService } from './services/tabService.js';
import { createTabsRouter } from './routes/tabs.js';
import express from 'express';
import { createHistoryService, RETENTION_DAYS } from './services/historyService.js';
import { createScheduledMessageService } from './services/scheduledMessageService.js';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSplitStore } from './repositories/splitStore.js';
import { createContactRepository } from './repositories/contactRepository.js';
import { createMessageRepository } from './repositories/messageRepository.js';
import { createContactService } from './services/contactService.js';
import { createMessageService } from './services/messageService.js';
import { createContactsRouter } from './routes/contacts.js';
import { AppError, notFound, invalidInput as invalidScheduleQuery } from './utils/errors.js';
import { logEvent } from './utils/logger.js';
import { createLineWebhookRouter } from './providers/line/lineWebhook.js';
import { createLineClient } from './providers/line/lineClient.js';
import { createSlackReceiver } from './providers/slack/slackEvents.js';
import { createReplyService } from './services/replyService.js';
import { createMessagesRouter } from './routes/messages.js';
import { createReminderRepository } from './repositories/reminderRepository.js';
import { createReminderService } from './services/reminderService.js';
import { createRemindersRouter } from './routes/reminders.js';

function errorHandler(error, _req, res, _next) {
  let safe = error instanceof AppError ? error : new AppError(500, 'INTERNAL_ERROR', '処理に失敗しました。');
  if (['entity.parse.failed', 'encoding.unsupported', 'charset.unsupported'].includes(error.type)) {
    safe = new AppError(400, 'VALIDATION_ERROR', '本文形式を確認してください。');
  }
  if (error.type === 'entity.too.large') safe = new AppError(413, 'PAYLOAD_TOO_LARGE', '送信データが大きすぎます。');
  if (safe.status >= 500) logEvent('REQUEST_FAILED');
  res.status(safe.status).json({ error: { code: safe.code, message: safe.message } });
}

export function createWebhookApp(store, options = {}) {
  const app = express();
  app.disable('x-powered-by');
  const lineClient = createLineClient();
  const mediaRepository = options.mediaRepository ?? createMediaRepository();
  app.use('/media', createMediaRouter(mediaRepository));
  app.use('/webhooks/line', createLineWebhookRouter(createMessageService(createMessageRepository(store)), {
    getDisplayName: lineClient.getDisplayName, getImage: lineClient.getImage, mediaRepository, ...options
  }));
  app.use((_req, _res, next) => next(notFound()));
  app.use(errorHandler);
  return app;
}

export function createApp(store, { providers = { line: createLineClient() }, mediaRepository = createMediaRepository(), publicBaseUrl = process.env.PUBLIC_BASE_URL, push } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/api', express.json({ limit: '64kb' }));
  if (push) app.use('/api/push', createPushRouter(push));
  app.get('/api/health', (_req, res) => res.json({ data: { status: 'ok' } }));
  app.use('/api/media', createMediaRouter(mediaRepository));
  app.use('/api/tabs', createTabsRouter(createTabService(createTabRepository(store))));
  app.use('/api/reminders', createRemindersRouter(createReminderService(createReminderRepository(store))));
  const replies = createReplyService(createMessageRepository(store), providers, { mediaRepository, publicBaseUrl });
  app.use('/api/messages', createMessagesRouter(replies));
  const schedules = createScheduledMessageService(store, replies);
  app.locals.schedules = schedules;
  const history = createHistoryService(store, mediaRepository, replies);
  app.locals.history = history;
  app.get('/api/data-policy', (_req, res) => res.json({ data: { retentionDays: RETENTION_DAYS } }));
  app.delete('/api/contacts/:id', async (req, res) => {
    if (Object.keys(req.query).length) throw invalidScheduleQuery();
    res.json({ data: await history.clear(req.params.id, req.body, true) });
  });
  app.delete('/api/contacts/:id/messages', async (req, res) => {
    if (Object.keys(req.query).length) throw invalidScheduleQuery();
    res.json({ data: await history.clear(req.params.id, req.body) });
  });
  app.get('/api/scheduled-messages', (req, res) => {
    if (Object.keys(req.query).some(key => key !== 'conversationId')) throw invalidScheduleQuery();
    res.json({ data: schedules.list(req.query.conversationId) });
  });
  app.post('/api/scheduled-messages', async (req, res) => {
    if (Object.keys(req.query).length) throw invalidScheduleQuery();
    res.status(201).json({ data: await schedules.create(req.body) });
  });
  app.delete('/api/scheduled-messages/:id', async (req, res) => {
    if (Object.keys(req.query).length || req.body !== undefined &&
        (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length)) throw invalidScheduleQuery();
    res.json({ data: await schedules.cancel(req.params.id) });
  });
  app.use('/api/contacts', createContactsRouter(
    createContactService(createContactRepository(store)),
    createMessageService(createMessageRepository(store))
  ));
  app.use((_req, _res, next) => next(notFound()));
  app.use(errorHandler);
  return app;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const demo = isDemoMode();
    const dataUrl = new URL(demo ? '../data/demo/' : '../data/', import.meta.url);
    const store = demo ? await openDemoStore(fileURLToPath(dataUrl))
      : await createSplitStore(fileURLToPath(new URL('store.json', dataUrl)));
    const push = await createPushService(store, fileURLToPath(new URL('push.json', dataUrl)));
    const mediaRepository = createMediaRepository(fileURLToPath(new URL('media/', dataUrl)));
    const slack = demo ? createDemoProvider('slack') : createSlackReceiver(createMessageService(createMessageRepository(store)));
    const adminApp = createApp(store, { providers: { line: demo ? createDemoProvider('line') : createLineClient(), slack },
      mediaRepository, publicBaseUrl: demo ? 'https://demo.invalid' : process.env.PUBLIC_BASE_URL, push });
    if (demo) logEvent('DEMO_MODE');
    let closing = false;
    let listening = 0;
    const onListening = () => {
      if (++listening === 2 && !closing) {
        logEvent('SERVER_STARTED');
        push.start();
        adminApp.locals.history.start();
        void slack.start();
        void adminApp.locals.schedules.start().catch(() => logEvent('SCHEDULE_PROCESS_FAILED'));
      }
    };
    const servers = [adminApp.listen(3000, '127.0.0.1', onListening),
      (demo ? express() : createWebhookApp(store, { mediaRepository })).listen(3001, '127.0.0.1', onListening)];
    const close = () => {
      if (closing) return;
      closing = true;
      push.stop();
      adminApp.locals.schedules.stop();
      adminApp.locals.history.stop();
      servers.forEach(server => server.close());
      void slack.stop();
    };
    for (const server of servers) server.on('error', () => {
      logEvent('SERVER_ERROR'); process.exitCode = 1; close();
    });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, close);
  } catch {
    logEvent('STARTUP_FAILED');
    process.exitCode = 1;
  }
}
