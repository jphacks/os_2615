/*
後で返信の設定・一覧・取消APIを公開する。
*/
import { Router } from 'express';
import { invalidInput } from '../utils/errors.js';

export function createRemindersRouter(service) {
  const router = Router();
  router.get('/', (req, res) => {
    if (Object.keys(req.query).some(key => key !== 'status')) throw invalidInput();
    res.json({ data: service.list(req.query.status) });
  });
  router.post('/', async (req, res) => {
    if (Object.keys(req.query).length) throw invalidInput();
    const { reminder, created } = await service.save(req.body);
    res.status(created ? 201 : 200).json({ data: reminder });
  });
  router.patch('/:id', async (req, res) => {
    if (Object.keys(req.query).length) throw invalidInput();
    res.json({ data: await service.cancel(req.params.id, req.body) });
  });
  return router;
}
