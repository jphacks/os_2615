/* 予約送信の時刻、永続化、二重送信防止、再起動・失敗時を外部APIのStubで検証。 */
import test from 'node:test';import assert from 'node:assert/strict';import * as fs from 'node:fs/promises';import {join} from 'node:path';import {tmpdir}from'node:os';import {randomUUID}from'node:crypto';
import {createSplitStore}from'../src/repositories/splitStore.js';import {createMessageRepository}from'../src/repositories/messageRepository.js';import {createReplyService}from'../src/services/replyService.js';import {createScheduledMessageService}from'../src/services/scheduledMessageService.js';import {createApp}from'../src/app.js';import {AppError}from'../src/utils/errors.js';import {demoState}from'./fixtures/demoState.js';
async function setup(t,options={}){
 const dir=await fs.mkdtemp(join(tmpdir(),'konekuto-schedule-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const path=join(dir,'store.json');await fs.writeFile(path,JSON.stringify(demoState()));const store=await createSplitStore(path);let time=Date.parse('2027-01-01T00:00:00Z'),calls=[];
 const provider={sendText:async ctx=>{calls.push(ctx);if(options.send)return options.send(ctx);return {platform:ctx.conversation.platform,messageType:'text',platformMessageId:randomUUID(),senderId:'bot',text:ctx.text,timestamp:new Date(time).toISOString(),isFromMe:true,metadata:{}}}};
 const replies=createReplyService(createMessageRepository(store),{line:provider,slack:provider});const service=createScheduledMessageService(store,replies,{now:()=>time,intervalMs:5});t.after(()=>service.stop());
 const input=(platform='line')=>({requestId:randomUUID(),conversationId:`demo-conversation-${platform}`,text:'予約の文章',sendAt:new Date(time+60000).toISOString()});
 return {store,path,service,replies,input,calls,setTime:v=>{time=v},getTime:()=>time};
}
test('LINE・Slackの予約は時刻前に送らず、成功と履歴を同時保存して一度だけ送る',async t=>{
 const f=await setup(t);for(const platform of ['line','slack'])await f.service.create(f.input(platform));
 await f.service.runDue();assert.equal(f.calls.length,0);assert.equal(f.store.read().messages.length,2);
 f.setTime(f.getTime()+60000);await Promise.all([f.service.runDue(),f.service.runDue()]);await f.service.runDue();
 assert.equal(f.calls.length,2);assert.ok(f.service.list().every(job=>job.status==='sent'));
 assert.equal(f.store.read().messages.length,4);assert.ok(f.store.read().conversations.every(c=>!c.hasUnreplied));
 assert.deepEqual((await createSplitStore(f.path)).read(),f.store.read());
});
test('同じ予約IDの再送は重複せず、取消した予約は送らない',async t=>{
 const f=await setup(t);const input=f.input();const job=await f.service.create(input);assert.deepEqual(await f.service.create(input),job);assert.equal(f.service.list().length,1);
 await assert.rejects(f.service.create({...input,text:'変更'}),e=>e.status===409);
 await f.service.cancel(job.id);await f.service.cancel(job.id);f.setTime(f.getTime()+60000);await f.service.runDue();assert.equal(f.calls.length,0);
});
test('再起動時に送信中は要確認、停止中に期限を過ぎた予約は未送信で終了',async t=>{
 const f=await setup(t);const a=await f.service.create(f.input());const b=await f.service.create(f.input());const future=await f.service.create({...f.input(),sendAt:new Date(f.getTime()+3600000).toISOString()});
 await f.store.update(s=>{s.scheduledMessages.find(j=>j.id===a.id).status='sending'});f.setTime(f.getTime()+60000);await f.service.recover();await f.service.runDue();
 const jobs=f.service.list();assert.equal(jobs.find(j=>j.id===a.id).status,'unknown');assert.equal(jobs.find(j=>j.id===b.id).status,'missed');assert.equal(jobs.find(j=>j.id===future.id).status,'pending');assert.equal(f.calls.length,0);
});
test('外部API拒否・タイムアウトは履歴を増やさず自動再送しない',async t=>{
 for(const [code,status]of[['PROVIDER_ERROR','failed'],['DELIVERY_UNKNOWN','unknown']]){
  const f=await setup(t,{send:async()=>{throw new AppError(502,code,'safe')}});await f.service.create(f.input());f.setTime(f.getTime()+60000);await f.service.runDue();await f.service.runDue();assert.equal(f.calls.length,1);assert.equal(f.service.list()[0].status,status);assert.equal(f.store.read().messages.length,2);assert.equal(f.store.read().conversations[0].hasUnreplied,true);
 }
});
test('送信前の保存失敗は送らず、送信後の保存失敗は要確認にして再送しない',async t=>{
 const f=await setup(t);await f.service.create(f.input());f.setTime(f.getTime()+60000);
 const update=f.store.update;let fail=true;f.store.update=fn=>{if(fail){fail=false;return Promise.reject(Error('disk'))}return update(fn)};
 await assert.rejects(f.service.runDue());assert.equal(f.calls.length,0);assert.equal(f.service.list()[0].status,'pending');
 const repo=createMessageRepository(f.store);const reply=createReplyService({...repo,saveReply:async()=>{throw Error('disk')}},{line:{sendText:async ctx=>{f.calls.push(ctx);return {text:ctx.text}}}});
 const worker=createScheduledMessageService(f.store,reply,{now:f.getTime});await worker.runDue();assert.equal(f.calls.length,1);assert.equal(worker.list()[0].status,'unknown');await worker.runDue();assert.equal(f.calls.length,1);
});
test('送信が始まった予約は取消不可、処理完了後も重複しない',async t=>{
 let release,entered;const began=new Promise(r=>entered=r);const wait=new Promise(r=>release=r);
 const f=await setup(t,{send:async ctx=>{entered();await wait;throw new AppError(502,'DELIVERY_UNKNOWN','safe')}});const job=await f.service.create(f.input());f.setTime(f.getTime()+60000);const run=f.service.runDue();await began;await assert.rejects(f.service.cancel(job.id),e=>e.status===409);release();await run;await f.service.runDue();assert.equal(f.calls.length,1);
});
test('予約APIは不正本文・過去日時を拒否し、保存と取消が共通形式で返る',async t=>{
 const f=await setup(t);const app=createApp(f.store,{providers:{}});const server=app.listen(0,'127.0.0.1');await new Promise((r,j)=>{server.once('listening',r);server.once('error',j)});t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections()}));
 const call=async(path,method='GET',body)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api/scheduled-messages${path}`,{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});return {status:r.status,body:await r.json()}};
 const input={...f.input(),sendAt:new Date(Date.now()+60000).toISOString()};assert.equal((await call('','POST',input)).status,201);assert.equal((await call('?conversationId=demo-conversation-line')).body.data.length,1);
 for(const bad of [null,{}, {...input,text:''},{...input,sendAt:'2000-01-01T00:00:00Z'},{...input,requestId:'bad'},{...input,text:'x'.repeat(5001)},{...input,extra:1}])assert.equal((await call('','POST',bad)).status,400);
 assert.equal((await call('?bad=1')).status,400);assert.equal((await call('?conversationId=x&conversationId=y')).status,400);
 assert.equal((await call('/'+input.requestId,'DELETE',{})).body.data.status,'cancelled');assert.equal((await call('/missing','DELETE',{})).status,404);
});
test('起動したワーカーは未来の予約を実行し、停止後に別の予約を実行しない',async t=>{
 const f=await setup(t);await f.service.create(f.input());await f.service.start();f.setTime(f.getTime()+60000);
 const deadline=Date.now()+1000;while(f.service.list()[0].status!=='sent'&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));
 assert.equal(f.service.list()[0].status,'sent');assert.equal(f.calls.length,1);
 await f.service.create(f.input());f.service.stop();f.setTime(f.getTime()+60000);await f.service.runDue();assert.equal(f.calls.length,1);
});
test('大きく遅延した予約は自動送信しない',async t=>{
 const f=await setup(t);await f.service.create(f.input());f.setTime(f.getTime()+7*60000);await f.service.runDue();assert.equal(f.calls.length,0);assert.equal(f.service.list()[0].status,'missed');
});
test('予約上限は現在から14日後まで。境界は受付し1ミリ秒超過は拒否',async t=>{
 const f=await setup(t);const limit=f.getTime()+14*24*60*60*1000;
 const job=await f.service.create({...f.input(),sendAt:new Date(limit).toISOString()});
 assert.equal(Date.parse(job.sendAt),limit);
 await assert.rejects(async()=>f.service.create({...f.input(),sendAt:new Date(limit+1).toISOString()}),e=>e.status===400&&e.message.includes('14日'));
 assert.equal(f.service.list().length,1);
});
