import { Router } from 'express';
import { AppError, invalidInput } from '../utils/errors.js';
export function createPushRouter(push) {
  const router = Router();
  router.get('/config', (_req, res) => res.json({ data: { publicKey: push.publicKey } }));
  // JSONのみ受け付け、ブラウザからのクロスサイト登録・解除を防ぐ。
  router.use((req, _res, next) => {
    if (req.get('sec-fetch-site') === 'cross-site' || !req.is('application/json') || Object.keys(req.query).length) throw invalidInput();
    next();
  });
  router.post('/subscribe', async (req, res) => { await push.subscribe(req.body); res.json({ data: { enabled: true } }); });
  router.post('/unsubscribe', async (req, res) => { await push.unsubscribe(req.body); res.json({ data: { enabled: false } }); });
  const tests = new Map();
  router.post('/test', async (req, res) => {
    const endpoint = req.body?.endpoint;
    if (typeof endpoint !== 'string') throw invalidInput();
    if (Date.now() - (tests.get(endpoint) ?? 0) < 60000) throw new AppError(429, 'RATE_LIMITED', 'テスト通知は1分おいてからお試しください。');
    if (tests.size > 200) tests.clear();
    tests.set(endpoint, Date.now());
    try { await push.test(req.body); }
    catch { throw new AppError(502, 'PUSH_DELIVERY_FAILED', '通知を送信できませんでした。通知を有効にし直してお試しください。'); }
    res.json({ data: { sent: true } });
  });
  return router;
}
