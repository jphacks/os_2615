/*
管理API・LINE専用Webhookを別ポートで起動し、Slack Socket Modeも同じ保存層へ接続する。
*/
import 'dotenv/config';
import { createMediaRepository } from './repositories/mediaRepository.js';
import { createMediaRouter } from './routes/media.js';
import { createTabRepository } from './repositories/tabRepository.js';
import { createTabService } from './services/tabService.js';
import { createTabsRouter } from './routes/tabs.js';
import express from 'express';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSplitStore } from './repositories/splitStore.js';
import { createContactRepository } from './repositories/contactRepository.js';
import { createMessageRepository } from './repositories/messageRepository.js';
import { createContactService } from './services/contactService.js';
import { createMessageService } from './services/messageService.js';
import { createContactsRouter } from './routes/contacts.js';
import { AppError, notFound } from './utils/errors.js';
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

export function createApp(store, { providers = { line: createLineClient() }, mediaRepository = createMediaRepository(), publicBaseUrl = process.env.PUBLIC_BASE_URL } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/api', express.json({ limit: '64kb' }));
  app.get('/api/health', (_req, res) => res.json({ data: { status: 'ok' } }));
  app.use('/api/media', createMediaRouter(mediaRepository));
  app.use('/api/tabs', createTabsRouter(createTabService(createTabRepository(store))));
  app.use('/api/reminders', createRemindersRouter(createReminderService(createReminderRepository(store))));
  app.use('/api/messages', createMessagesRouter(createReplyService(createMessageRepository(store), providers, { mediaRepository, publicBaseUrl })));
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
    const store = await createSplitStore(fileURLToPath(new URL('../data/store.json', import.meta.url)));
    const slack = createSlackReceiver(createMessageService(createMessageRepository(store)));
    let closing = false;
    let listening = 0;
    const onListening = () => {
      if (++listening === 2 && !closing) {
        logEvent('SERVER_STARTED');
        void slack.start();
      }
    };
    const servers = [createApp(store, { providers: { line: createLineClient(), slack } }).listen(3000, '127.0.0.1', onListening),
      createWebhookApp(store).listen(3001, '127.0.0.1', onListening)];
    const close = () => {
      if (closing) return;
      closing = true;
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
