/*
共通形式の返信リクエストを受け、成功時だけ201と保存結果を返す。
*/
import express, { Router } from 'express';
import { invalidInput } from '../utils/errors.js';

export function createMessagesRouter(replies) {
  const router = Router();
  router.post('/reply', async (req, res) => {
    if (Object.keys(req.query).length) throw invalidInput();
    res.status(201).json({ data: await replies.reply(req.body) });
  });
  router.post('/reply-image', express.raw({ type: ['image/jpeg', 'image/png'], limit: '1mb' }), async (req, res) => {
    if (Object.keys(req.query).some(key => key !== 'conversationId') || typeof req.query.conversationId !== 'string') throw invalidInput();
    res.status(201).json({ data: await replies.replyImage(req.query.conversationId, req.body) });
  });
  return router;
}
