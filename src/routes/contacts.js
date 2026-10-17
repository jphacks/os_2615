/*
人物一覧・会話履歴のAPIを共通レスポンス形式で公開する。
*/
import { Router } from 'express';
import { invalidInput } from '../utils/errors.js';

export function createContactsRouter(contacts, messages) {
  const router = Router();
  router.get('/', (req, res) => {
    if (Object.keys(req.query).some(key => key !== 'filter')) throw invalidInput();
    res.json({ data: contacts.list(req.query.filter) });
  });
  router.get('/:id/messages', (req, res) => {
    if (Object.keys(req.query).length) throw invalidInput();
    res.json({ data: messages.history(req.params.id) });
  });
  return router;
}
