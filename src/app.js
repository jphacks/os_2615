/*
Expressアプリの組み立てとローカル起動。LINE用rawルートはJSON解析前に追加する。
*/
import 'dotenv/config';
import express from 'express';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJsonStore } from './repositories/jsonStore.js';
import { createContactRepository } from './repositories/contactRepository.js';
import { createMessageRepository } from './repositories/messageRepository.js';
import { createContactService } from './services/contactService.js';
import { createMessageService } from './services/messageService.js';
import { createContactsRouter } from './routes/contacts.js';
import { AppError, notFound } from './utils/errors.js';
import { logEvent } from './utils/logger.js';

export function createApp(store) {
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/api', express.json({ limit: '64kb' }));
  app.get('/api/health', (_req, res) => res.json({ data: { status: 'ok' } }));
  app.use('/api/contacts', createContactsRouter(
    createContactService(createContactRepository(store)),
    createMessageService(createMessageRepository(store))
  ));
  app.use((_req, _res, next) => next(notFound()));
  app.use((error, _req, res, _next) => {
    let safe = error instanceof AppError ? error : new AppError(500, 'INTERNAL_ERROR', '処理に失敗しました。');
    if (error.type === 'entity.parse.failed') safe = new AppError(400, 'VALIDATION_ERROR', 'JSON形式を確認してください。');
    if (error.type === 'entity.too.large') safe = new AppError(413, 'PAYLOAD_TOO_LARGE', '送信データが大きすぎます。');
    if (safe.status >= 500) logEvent('REQUEST_FAILED');
    res.status(safe.status).json({ error: { code: safe.code, message: safe.message } });
  });
  return app;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const store = await createJsonStore(fileURLToPath(new URL('../data/store.json', import.meta.url)));
    const server = createApp(store).listen(3000, '127.0.0.1', () => logEvent('SERVER_STARTED'));
    server.on('error', () => { logEvent('SERVER_ERROR'); process.exitCode = 1; });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
  } catch {
    logEvent('STARTUP_FAILED');
    process.exitCode = 1;
  }
}
