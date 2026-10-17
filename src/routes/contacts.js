/*
人物一覧・会話履歴・お気に入り更新APIを共通レスポンス形式で公開する。
*/
import { Router } from 'express';
import { invalidInput } from '../utils/errors.js';

export function createContactsRouter(contacts, messages) {
  const router = Router();
  router.patch('/:id/search-name', async (req, res) => {
    if (Object.keys(req.query).length) throw invalidInput();
    res.json({ data: await contacts.setSearchName(req.params.id, req.body) });
  });
  router.patch('/:id/favorite', async (req, res) => {
    if (Object.keys(req.query).length) throw invalidInput();
    res.json({ data: await contacts.setFavorite(req.params.id, req.body) });
  });
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
