/* 分割保存の移行・再起動・他機能との互換性・保存障害を検証する。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSplitStore } from '../src/repositories/splitStore.js';
import { createContactRepository } from '../src/repositories/contactRepository.js';
import { createMessageRepository } from '../src/repositories/messageRepository.js';
import { demoState } from './fixtures/demoState.js';
async function fixture(t) {
 const dir=await fs.mkdtemp(join(tmpdir(),'konekuto-split-'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const path=join(dir,'store.json');
 const state=demoState();
 state.contacts[0].searchName='やまだ';
 state.tabs=[{id:'tab',name:'仕事',contactIds:[state.contacts[0].id]}];
 state.reminders=[{id:'reminder',conversationId:state.conversations[0].id,messageId:state.messages[0].id,remindAt:'2099-01-01T00:00:00.000Z',status:'pending'}];
 await fs.writeFile(path,JSON.stringify(state));
 const index=async()=>JSON.parse(await fs.readFile(path,'utf8'));
 return {dir,path,state,index};
}
test('全モデルを保ち旧形式から移行・バックアップ・再起動する',async t=>{
 const {dir,path,state,index}=await fixture(t);
 const store=await createSplitStore(path);
 assert.deepEqual(store.read(),state);
 const saved=await index();assert.equal(saved.messages,undefined);assert.equal(saved.storageFormat,'contacts-v1');
 assert.equal(saved.messageFiles.length,2);
 for(const ref of saved.messageFiles)assert.ok(ref.file.startsWith(`${ref.platform}/${ref.contactId}/messages-`));
 const backups=(await fs.readdir(dir)).filter(name=>name.startsWith('store.legacy-'));
 assert.equal(backups.length,1);assert.deepEqual(JSON.parse(await fs.readFile(join(dir,backups[0]),'utf8')),state);
 assert.deepEqual((await createSplitStore(path)).read(),state);
 assert.equal((await fs.readdir(dir)).filter(name=>name.startsWith('store.legacy-')).length,1);
});
test('お気に入りで履歴を書き直さず、LINE受信ではLINE相手の履歴だけ更新',async t=>{
 const {dir,path,index}=await fixture(t);const store=await createSplitStore(path);
 const before=await index();
 await createContactRepository(store).setFavorite('demo-contact-line',true);
 assert.deepEqual((await index()).messageFiles,before.messageFiles);
 const message={...store.read().messages[0],platformMessageId:'new',timestamp:new Date().toISOString()};
 await createMessageRepository(store).receive({platform:'line',platformUserId:'demo-user-line',platformConversationId:'demo-destination-line',displayName:'山田',message});
 const after=await index();
 assert.equal(after.messageFiles.find(r=>r.platform==='slack').file,before.messageFiles.find(r=>r.platform==='slack').file);
 const previous=before.messageFiles.find(r=>r.platform==='line').file;
 assert.notEqual(after.messageFiles.find(r=>r.platform==='line').file,previous);
 await assert.rejects(fs.readFile(join(dir,previous)),e=>e.code==='ENOENT');
 assert.deepEqual((await createSplitStore(path)).read(),store.read());
});
test('管理ファイル切替失敗でメモリ・再起動後の状態を保持し後続保存で復旧',async t=>{
 const {path}=await fixture(t);let fail=false;
 const store=await createSplitStore(path,{io:{...fs,rename:async(...args)=>{if(fail)throw Error('private');return fs.rename(...args);}}});
 const before=store.read();const disk=await fs.readFile(path,'utf8');fail=true;
 await assert.rejects(store.update(state=>{state.messages[0].text='changed';}),e=>e.code==='STORAGE_ERROR');
 assert.deepEqual(store.read(),before);assert.equal(await fs.readFile(path,'utf8'),disk);
 assert.deepEqual((await createSplitStore(path)).read(),before);
 fail=false;await store.update(state=>{state.messages[0].text='updated';});
 assert.deepEqual((await createSplitStore(path)).read(),store.read());
});
test('分割履歴の欠損・破損を空データと扱わず起動を失敗させる',async t=>{
 const {dir,path,index}=await fixture(t);await createSplitStore(path);
 const saved=await index();const file=join(dir,saved.messageFiles[0].file);const text=await fs.readFile(file,'utf8');
 await fs.unlink(file);await assert.rejects(createSplitStore(path),e=>e.code==='STORAGE_ERROR');
 await fs.writeFile(file,'[]');await assert.rejects(createSplitStore(path),e=>e.code==='STORAGE_ERROR');
 await fs.writeFile(file,text);assert.equal((await createSplitStore(path)).read().messages.length,2);
});
test('移行失敗時は旧ファイルを保持し、復旧後に再移行できる',async t=>{
 const {path,state}=await fixture(t);const original=await fs.readFile(path,'utf8');
 await assert.rejects(createSplitStore(path,{io:{...fs,rename:async()=>{throw Error('failure');}}}),e=>e.code==='STORAGE_ERROR');
 assert.equal(await fs.readFile(path,'utf8'),original);
 assert.deepEqual((await createSplitStore(path)).read(),state);
});
test('不正な参照パス・順序を拒否し、並行更新も保持する',async t=>{
 const {path,index}=await fixture(t);const store=await createSplitStore(path);
 await Promise.all([store.update(s=>{s.contacts[0].isFavorite=true;}),store.update(s=>{s.contacts[1].searchName='さとう';})]);
 assert.deepEqual((await createSplitStore(path)).read(),store.read());
 const saved=await index();saved.messageFiles[0].file='../outside.json';await fs.writeFile(path,JSON.stringify(saved));
 await assert.rejects(createSplitStore(path),e=>e.code==='STORAGE_ERROR');
});
test('履歴ファイルの書き込み失敗で既存履歴を保持する',async t=>{
 const {path}=await fixture(t);let fail=false;
 const store=await createSplitStore(path,{io:{...fs,writeFile:async(p,...args)=>{if(fail && String(p).includes('/messages-'))throw Error('write failure');return fs.writeFile(p,...args);}}});
 const before=store.read();fail=true;
 await assert.rejects(store.update(state=>{state.messages[0].text='not saved';}),e=>e.code==='STORAGE_ERROR');
 assert.deepEqual(store.read(),before);assert.deepEqual((await createSplitStore(path)).read(),before);
});
test('新規の空ストレージから保存して再読み込みできる',async t=>{
 const {dir}=await fixture(t);const path=join(dir,'new','store.json');
 const store=await createSplitStore(path);assert.deepEqual(store.read().messages,[]);
 await store.update(state=>Object.assign(state,demoState()));
 assert.deepEqual((await createSplitStore(path)).read(),store.read());
});
