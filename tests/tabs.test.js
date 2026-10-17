/* カスタムタブの旧データ互換・所属・永続化・保存失敗を検証する。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createJsonStore } from '../src/repositories/jsonStore.js';
import { createApp } from '../src/app.js';
import { demoState } from './fixtures/demoState.js';
async function setup(t, io) {
 const dir = await fs.mkdtemp(join(tmpdir(), 'konekuto-tabs-'));
 t.after(() => fs.rm(dir, {recursive:true, force:true}));
 const path = join(dir, 'store.json');
 await fs.writeFile(path, JSON.stringify(demoState()));
 const store = await createJsonStore(path, io ? {io} : {});
 const server = createApp(store, {providers:{}}).listen(0, '127.0.0.1');
 await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const call = async (url, method='GET', body) => {
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/tabs${url}`, {method,
   ...(body === undefined ? {} : {headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
  return {status:res.status, body:await res.json()};
 };
 return {store,path,call};
}
test('旧データからタブ作成、複数所属、解除、再起動、削除で履歴を保持',async t=>{
 const {store,path,call}=await setup(t); const before=store.read();
 assert.deepEqual((await call('')).body.data,[]);
 const a=await call('','POST',{name:'  仕事  '}); assert.equal(a.status,201);assert.equal(a.body.data.name,'仕事');
 const b=await call('','POST',{name:'仲間'});const id=a.body.data.id,id2=b.body.data.id;
 for(const tab of [id,id2]) for(let i=0;i<2;i++) assert.equal((await call(`/${tab}/contacts/demo-contact-line`,'PUT',{})).status,200);
 assert.equal(store.read().tabs[0].contactIds.length,1);
 await call(`/${id}/contacts/demo-contact-slack`,'PUT',{});
 assert.deepEqual((await createJsonStore(path)).read(),store.read());
 await call(`/${id}/contacts/demo-contact-line`,'DELETE',{});
 assert.deepEqual(store.read().tabs[0].contactIds,['demo-contact-slack']);
 assert.deepEqual(store.read().tabs[1].contactIds,['demo-contact-line']);
 assert.equal((await call(`/${id}`,'DELETE',{})).status,200);
 for(const key of ['contacts','messages','conversations','reminders'])assert.deepEqual(store.read()[key],before[key]);
});
test('不正入力・不在IDを拒否し、並行メンバー追加を失わない',async t=>{
 const {call,store}=await setup(t);
 for(const body of [{},[],null,{name:''},{name:' '.repeat(5)},{name:'a'.repeat(41)},{name:'仕事',extra:true}])assert.equal((await call('','POST',body)).status,400);
 assert.equal((await call('?unexpected=1')).status,400);
 const id=(await call('','POST',{name:'仕事'})).body.data.id;
 const results=await Promise.all(['line','slack'].map(p=>call(`/${id}/contacts/demo-contact-${p}`,'PUT',{})));
 assert.ok(results.every(r=>r.status===200));assert.equal(store.read().tabs[0].contactIds.length,2);
 assert.equal((await call(`/${id}/contacts/missing`,'PUT',{})).status,404);
 assert.equal((await call('/missing','DELETE',{})).status,404);
 assert.equal((await call(`/${id}/contacts/demo-contact-line`,'PUT',{extra:true})).status,400);
});
test('保存失敗は既存状態とディスクを保持し、復旧後に作成できる',async t=>{
 let fail=true;
 const {store,path,call}=await setup(t,{...fs,rename:async(...args)=>{if(fail)throw Error('private-details');return fs.rename(...args);}});
 const before=store.read(); const result=await call('','POST',{name:'仕事'});
 assert.equal(result.status,500);assert.equal(result.body.error.code,'STORAGE_ERROR');
 assert.deepEqual(store.read(),before);assert.deepEqual((await createJsonStore(path)).read(),before);
 fail=false;assert.equal((await call('','POST',{name:'仕事'})).status,201);
});
test('タブの前後移動を保存し、メンバー・会話を保持する', async t => {
 const {call,store,path}=await setup(t);
 const ids=[];
 for(const name of ['テスト','テスト2','テスト3'])ids.push((await call('','POST',{name})).body.data.id);
 await call(`/${ids[0]}/contacts/demo-contact-line`,'PUT',{});
 const contacts=store.read().contacts;
 assert.equal((await call(`/${ids[2]}/move`,'POST',{direction:'previous'})).status,200);
 assert.deepEqual(store.read().tabs.map(tab=>tab.id),[ids[0],ids[2],ids[1]]);
 await call(`/${ids[2]}/move`,'POST',{direction:'previous'});
 await call(`/${ids[2]}/move`,'POST',{direction:'previous'});
 assert.deepEqual(store.read().tabs.map(tab=>tab.id),[ids[2],ids[0],ids[1]]);
 await call(`/${ids[2]}/move`,'POST',{direction:'next'});
 assert.deepEqual((await createJsonStore(path)).read(),store.read());
 assert.deepEqual(store.read().tabs.find(tab=>tab.id===ids[0]).contactIds,['demo-contact-line']);
 assert.deepEqual(store.read().contacts,contacts);
 const before=store.read();
 for(const body of [{direction:'up'},{},{direction:'next',extra:1},null])assert.equal((await call(`/${ids[0]}/move`,'POST',body)).status,400);
 assert.equal((await call('/missing/move','POST',{direction:'next'})).status,404);
 assert.deepEqual(store.read(),before);
});
test('先頭・末尾への移動は他のタブの相対順と所属を保持する', async t => {
 const {call,store,path}=await setup(t);
 const ids=[];
 for(const name of ['A','B','C','D'])ids.push((await call('','POST',{name})).body.data.id);
 await call(`/${ids[2]}/contacts/demo-contact-line`,'PUT',{});
 for(let i=0;i<2;i++)assert.equal((await call(`/${ids[2]}/move`,'POST',{direction:'first'})).status,200);
 assert.deepEqual(store.read().tabs.map(tab=>tab.id),[ids[2],ids[0],ids[1],ids[3]]);
 for(let i=0;i<2;i++)assert.equal((await call(`/${ids[0]}/move`,'POST',{direction:'last'})).status,200);
 assert.deepEqual(store.read().tabs.map(tab=>tab.id),[ids[2],ids[1],ids[3],ids[0]]);
 assert.deepEqual(store.read().tabs[0].contactIds,['demo-contact-line']);
 assert.deepEqual((await createJsonStore(path)).read(),store.read());
});
