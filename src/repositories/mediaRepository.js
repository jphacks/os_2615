/* 画像をプラットフォーム別に保存する。公開URLはIDのみとし、旧保存先も読める。 */
import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError, invalidInput, notFound, storageError } from '../utils/errors.js';
export const MAX_IMAGE_BYTES = 1024 * 1024;
export function imageType(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw invalidInput();
  if (bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  throw new AppError(400, 'VALIDATION_ERROR', 'JPEGまたはPNG画像を選んでください。');
}
export function createMediaRepository(directory = fileURLToPath(new URL('../../data/media/', import.meta.url))) {
  return {
    async save(bytes, platform, maxBytes = MAX_IMAGE_BYTES) {
      if (!['line', 'slack'].includes(platform)) throw invalidInput();
      if (bytes.length > maxBytes) throw new AppError(413, 'PAYLOAD_TOO_LARGE', '画像の容量が上限を超えています。');
      const mimeType = imageType(bytes);
      const id = `${randomUUID()}.${mimeType === 'image/png' ? 'png' : 'jpg'}`;
      try { const folder = join(directory, platform); await fs.mkdir(folder,{recursive:true}); await fs.writeFile(join(folder,id),bytes,{flag:'wx',mode:0o600}); }
      catch { throw storageError(); }
      return { id, url: `/api/media/${id}`, mimeType, size: bytes.length };
    },
    async remove(id) {
      if (!/^[0-9a-f-]{36}\.(png|jpg)$/.test(id)) throw invalidInput();
      for (const folder of ['line', 'slack', 'unassigned', '']) {
        try { await fs.unlink(join(directory, folder, id)); }
        catch (e) { if (e.code !== 'ENOENT') throw storageError(); }
      }
    },
    async pruneOrphans(references, olderThan) {
      for (const folder of ['line', 'slack', 'unassigned', '']) {
        const path = join(directory, folder);
        let files;
        try { files = await fs.readdir(path); } catch (e) { if (e.code === 'ENOENT') continue; throw storageError(); }
        for (const id of files) {
          if (!/^[0-9a-f-]{36}\.(png|jpg)$/.test(id)) continue;
          const stat = await fs.stat(join(path,id)).catch(e => { if (e.code !== 'ENOENT') throw e; });
          if (stat?.isFile() && stat.mtimeMs < olderThan && !references().has(id)) await fs.unlink(join(path,id)).catch(e => { if (e.code !== 'ENOENT') throw e; });
        }
      }
    },
    async read(id) {
      if (!/^[0-9a-f-]{36}\.(png|jpg)$/.test(id)) throw notFound();
      for (const folder of ['line', 'slack', 'unassigned', '']) {
        try { return { bytes: await fs.readFile(join(directory,folder,id)), mimeType: id.endsWith('.png') ? 'image/png' : 'image/jpeg' }; }
        catch(error) { if(error.code !== 'ENOENT') throw storageError(); }
      }
      throw notFound();
    }
  };
}
