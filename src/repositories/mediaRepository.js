/* 画像バイナリをJSONと分離し、推測しにくいIDで保存・配信する。 */
import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError, invalidInput, notFound, storageError } from '../utils/errors.js';
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export function imageType(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw invalidInput();
  if (bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  throw new AppError(400, 'VALIDATION_ERROR', 'JPEGまたはPNG画像を選んでください。');
}
export function createMediaRepository(directory = fileURLToPath(new URL('../../data/media/', import.meta.url))) {
  return {
    async save(bytes, maxBytes = MAX_IMAGE_BYTES) {
      if (bytes.length > maxBytes) throw new AppError(413, 'PAYLOAD_TOO_LARGE', '画像の容量が上限を超えています。');
      const mimeType = imageType(bytes);
      const id = `${randomUUID()}.${mimeType === 'image/png' ? 'png' : 'jpg'}`;
      try { await fs.mkdir(directory,{recursive:true}); await fs.writeFile(join(directory,id),bytes,{flag:'wx',mode:0o600}); }
      catch { throw storageError(); }
      return { id, url: `/api/media/${id}`, mimeType, size: bytes.length };
    },
    async read(id) {
      if (!/^[0-9a-f-]{36}\.(png|jpg)$/.test(id)) throw notFound();
      try { return { bytes: await fs.readFile(join(directory,id)), mimeType: id.endsWith('.png') ? 'image/png' : 'image/jpeg' }; }
      catch(error) { if(error.code === 'ENOENT') throw notFound(); throw storageError(); }
    }
  };
}
