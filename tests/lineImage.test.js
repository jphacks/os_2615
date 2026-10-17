/* LINE画像の署名付き受信・保存・Push送信・失敗時を検証する。外部送信はStub。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHmac } from 'node:crypto';
import { createApp, createWebhookApp } from '../src/app.js';
import { createSplitStore } from '../src/repositories/splitStore.js';
import { createMediaRepository } from '../src/repositories/mediaRepository.js';
import { createLineClient } from '../src/providers/line/lineClient.js';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=','base64');
const secret='image-test-secret';
async function serve(t, app){const s=app.listen(0,'127.0.0.1');await new Promise((r,j)=>{s.once('listening',r);s.once('error',j);});t.after(()=>new Promise(r=>{s.close(r);s.closeAllConnections();}));return `http://127.0.0.1:${s.address().port}`;}
async function setup(t,{pushStatus=200,publicBaseUrl='https://demo.example',getImage=async()=>png}={}){
 const dir=await fs.mkdtemp(join(tmpdir(),'konekuto-image-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const path=join(dir,'store.json');const store=await createSplitStore(path);const media=createMediaRepository(join(dir,'media'));let pushes=[];
 const line=createLineClient({accessToken:'private-test-token',fetchImpl:async(url,options)=>{
  if(url.endsWith('/info'))return Response.json({userId:'bot-user'});
  pushes.push(JSON.parse(options.body));return Response.json(pushStatus===200?{sentMessages:[{id:'image-sent'}]}:{secret:'private-test-token'},{status:pushStatus});
 }});
 const api=await serve(t,createApp(store,{providers:{line},mediaRepository:media,publicBaseUrl}));
 const webhook=await serve(t,createWebhookApp(store,{mediaRepository:media,channelSecret:secret,getDisplayName:async()=> '画像ユーザー',getImage}));
 const event={type:'message',webhookEventId:'image-event',timestamp:Date.now(),source:{type:'user',userId:'U'+'a'.repeat(32)},message:{type:'image',id:'image-received',contentProvider:{type:'line'}}};
 const post=async(signature)=>{const body=JSON.stringify({events:[event]});return fetch(webhook+'/webhooks/line',{method:'POST',headers:{'Content-Type':'application/json','x-line-signature':signature??createHmac('sha256',secret).update(body).digest('base64')},body});};
 const send=async(bytes=png,type='image/png',id=store.read().conversations[0]?.id)=>fetch(`${api}/api/messages/reply-image?conversationId=${id}`,{method:'POST',headers:{'Content-Type':type},body:bytes});
 return {dir,path,store,media,api,webhook,post,send,pushes};
}
test('署名付き画像受信・重複排除・配信・再起動後の履歴を確認',async t=>{
 let downloads=0;const f=await setup(t,{getImage:async()=>{downloads++;return png;}});
 assert.equal((await f.post('bad')).status,401);assert.equal(downloads,0);
 assert.equal((await f.post()).status,200);assert.equal((await f.post()).status,200);assert.equal(downloads,1);
 const state=f.store.read();assert.equal(state.messages.length,1);assert.equal(state.messages[0].messageType,'image');assert.equal(state.conversations[0].hasUnreplied,true);
 const media=state.messages[0].media;
 const r=await fetch(f.api+media.url);assert.equal(r.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await r.arrayBuffer()),png);
 const publicImage=await fetch(f.webhook+'/media/'+media.id);assert.equal(publicImage.status,200);
 assert.deepEqual((await createSplitStore(f.path)).read(),state);
 assert.ok(!JSON.stringify(state).includes('private-test-token'));
});
test('画像Pushは保存済み宛先と公開URLを使い成功後に未返信を解除',async t=>{
 const f=await setup(t);await f.post();const response=await f.send();assert.equal(response.status,201);
 const result=await response.json();assert.equal(result.data.message.messageType,'image');assert.equal(result.data.conversation.hasUnreplied,false);
 assert.equal(f.pushes[0].to,'U'+'a'.repeat(32));assert.equal(f.pushes[0].messages[0].type,'image');
 const url=f.pushes[0].messages[0].originalContentUrl;assert.ok(url.startsWith('https://demo.example/media/'));assert.equal(f.pushes[0].messages[0].previewImageUrl,url);
 assert.equal((await fetch(f.api+result.data.message.media.url)).status,200);
 assert.deepEqual((await createSplitStore(f.path)).read(),f.store.read());
});
test('不正形式・容量超過・不在会話を送信前に拒否',async t=>{
 const f=await setup(t);await f.post();
 assert.equal((await f.send(Buffer.from('<svg>'),'image/png')).status,400);
 assert.equal((await f.send(png,'application/octet-stream')).status,400);
 assert.equal((await f.send(Buffer.alloc(1024*1024+1),'image/png')).status,413);
 assert.equal((await f.send(png,'image/png','missing')).status,404);assert.equal(f.pushes.length,0);assert.equal(f.store.read().messages.length,1);
});
test('公開URL未設定・Push失敗で未返信と送信履歴を変えない',async t=>{
 const missing=await setup(t,{publicBaseUrl:''});await missing.post();assert.equal((await missing.send()).status,503);assert.equal(missing.pushes.length,0);
 const failed=await setup(t,{pushStatus:400});await failed.post();const r=await failed.send();assert.equal(r.status,502);
 assert.ok(!JSON.stringify(await r.json()).includes('private-test-token'));assert.equal(failed.store.read().messages.length,1);assert.equal(failed.store.read().conversations[0].hasUnreplied,true);
});
test('LINE取得エラー・非画像ではメッセージ保存せず再受信で復旧',async t=>{
 let fail=true;const f=await setup(t,{getImage:async()=>{if(fail)throw Error('private');return png;}});
 assert.equal((await f.post()).status,500);assert.equal(f.store.read().messages.length,0);
 fail=false;assert.equal((await f.post()).status,200);
 await assert.rejects(f.media.read('../store.json'),e=>e.status===404);
});
test('LINE content取得は固定APIを使い容量超過・エラーを安全に扱う',async()=>{
 let called;
 const client=createLineClient({accessToken:'secret',fetchImpl:async(url,options)=>{called={url,options};return new Response(png);}});
 assert.deepEqual(await client.getImage('id /'),png);assert.equal(called.url,'https://api-data.line.me/v2/bot/message/id%20%2F/content');assert.equal(called.options.redirect,'error');
 const failed=createLineClient({accessToken:'secret',fetchImpl:async()=>new Response('private-token',{status:404})});
 await assert.rejects(failed.getImage('x'),e=>e.code==='PROVIDER_ERROR'&&!e.message.includes('private-token'));
 const large=createLineClient({accessToken:'secret',fetchImpl:async()=>new Response('',{headers:{'content-length':String(11*1024*1024)}})});
 await assert.rejects(large.getImage('x'),e=>e.code==='PROVIDER_ERROR');
});
