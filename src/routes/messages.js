/*
共通形式の返信リクエストを受け、成功時だけ201と保存結果を返す。
*/
import { Router } from 'express';
import { invalidInput } from '../utils/errors.js';

export function createMessagesRouter(replies) {
  const router = Router();
  router.post('/reply', async (req, res) => {
    if (Object.keys(req.query).length) throw invalidInput();
    res.status(201).json({ data: await replies.reply(req.body) });
  });
  return router;
}
