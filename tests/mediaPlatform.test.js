/* 画像の保存先分離、既存URLの互換性、入力の検証。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createMediaRepository} from '../src/repositories/mediaRepository.js';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=','base64');
test('LINE・Slackの画像を別フォルダに保存し同じURL形式で再読込できる',async t=>{
 const dir=await fs.mkdtemp(join(tmpdir(),'konekuto-media-platform-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const repo=createMediaRepository(dir);
 for(const platform of ['line','slack']){
  const image=await repo.save(png,platform);
  assert.deepEqual(await fs.readFile(join(dir,platform,image.id)),png);
  assert.equal(image.url,`/api/media/${image.id}`);
  assert.deepEqual((await createMediaRepository(dir).read(image.id)).bytes,png);
 }
 const old='11111111-1111-4111-8111-111111111111.png';
 await fs.writeFile(join(dir,old),png);
 assert.deepEqual((await repo.read(old)).bytes,png);
 await fs.mkdir(join(dir,'unassigned'));
 await fs.rename(join(dir,old),join(dir,'unassigned',old));
 assert.deepEqual((await repo.read(old)).bytes,png);
 for(const platform of [undefined,'../line','other'])await assert.rejects(repo.save(png,platform),e=>e.status===400);
 await assert.rejects(repo.save(png,'line',1),e=>e.status===413);
 await assert.rejects(repo.read('../store.json'),e=>e.status===404);
});

test('画像の保存上限は1MB、1バイト超過は拒否する',async t=>{
 const dir=await fs.mkdtemp(join(tmpdir(),'konekuto-limit-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const repo=createMediaRepository(dir), bytes=Buffer.alloc(1024*1024);png.copy(bytes);
 await repo.save(bytes,'line');await assert.rejects(repo.save(Buffer.concat([bytes,Buffer.from([0])]),'line'),e=>e.status===413);
});
