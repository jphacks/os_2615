/* カスタムタブの一覧・作成・削除とContact所属のAPI。 */
import { Router } from 'express';
import { invalidInput } from '../utils/errors.js';
export function createTabsRouter(service) {
  const router = Router();
  router.use((req, _res, next) => {
    if (Object.keys(req.query).length) throw invalidInput();
    if (req.method !== 'POST' && req.body !== undefined &&
        (typeof req.body !== 'object' || req.body === null || Array.isArray(req.body) || Object.keys(req.body).length)) throw invalidInput();
    next();
  });
  router.get('/', (_req, res) => res.json({ data: service.list() }));
  router.post('/', async (req, res) => res.status(201).json({ data: await service.create(req.body) }));
  router.post('/:id/move', async (req, res) => res.json({ data: await service.move(req.params.id, req.body) }));
  router.delete('/:id', async (req, res) => res.json({ data: await service.remove(req.params.id) }));
  router.put('/:id/contacts/:contactId', async (req, res) => res.json({ data: await service.setMember(req.params.id, req.params.contactId, true) }));
  router.delete('/:id/contacts/:contactId', async (req, res) => res.json({ data: await service.setMember(req.params.id, req.params.contactId, false) }));
  return router;
}
