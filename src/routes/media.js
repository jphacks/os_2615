/* 管理画面とLINEの画像取得向けに、保存済みのJPEG/PNGだけを返す。 */
import { Router } from 'express';
import { invalidInput } from '../utils/errors.js';
export function createMediaRouter(repository) {
  const router=Router();
  router.get('/:id',async(req,res)=>{
    if(Object.keys(req.query).length)throw invalidInput();
    const media=await repository.read(req.params.id);
    res.set('X-Content-Type-Options','nosniff');
    res.set('Cache-Control','no-store');
    res.type(media.mimeType).send(media.bytes);
  });
  return router;
}
