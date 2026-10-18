import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createSlackClient} from '../src/providers/slack/slackClient.js';
import {createSlackMessageHandler} from '../src/providers/slack/slackEvents.js';
import {createSplitStore} from '../src/repositories/splitStore.js';
import {createMessageRepository} from '../src/repositories/messageRepository.js';
import {createMessageService} from '../src/services/messageService.js';
import {createMediaRepository} from '../src/repositories/mediaRepository.js';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=','base64');
const file={id:'F123',size:png.length,mimetype:'image/png',url_private:'https://files.slack.com/files-pri/T1-F123/image.png'};
const event={type:'message',channel_type:'im',channel:'D123',user:'U123',ts:'1792198800.123456',text:'写真です',files:[file]};
async function setup(t,getImage){const dir=await fs.mkdtemp(join(tmpdir(),'konekuto-slack-image-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const store=await createSplitStore(join(dir,'store.json')),media=createMediaRepository(join(dir,'media'));const handle=createSlackMessageHandler(createMessageService(createMessageRepository(store)),{teamId:'T1',botUserId:'UBOT',getDisplayName:async()=> '画像の相手',getImage,mediaRepository:media});return {store,media,handle};}
test('Slack画像は通常DM・file_share形式で保存し、複数添付と重複受信に対応する',async t=>{
 let calls=0;const f=await setup(t,async()=>{calls++;return png;});
 const payload={event:{...event,subtype:'file_share',files:[file,{...file,id:'F456'}]},body:{event_id:'Ev1'}};
 assert.equal(await f.handle(payload),true);assert.equal(await f.handle(payload),true);
 const messages=f.store.read().messages;assert.equal(messages.length,2);assert.equal(calls,2);assert.equal(messages[0].text,'写真です');assert.equal(messages[1].text,'[画像]');
 for(const m of messages){assert.equal(m.messageType,'image');assert.deepEqual((await f.media.read(m.media.id)).bytes,png);}
 assert.ok(!JSON.stringify(messages).includes('url_private'));assert.ok(!JSON.stringify(messages).includes('files.slack.com'));
 assert.equal(await f.handle({event:{...event,ts:'1792198801.123456'},body:{event_id:'Ev2'}}),true);assert.equal(f.store.read().messages.length,3);
});
test('Slack画像取得はBotトークンを認証ヘッダーに限定し、外部URLへ送らない',async()=>{
 let called=0;
 const client=createSlackClient({files:{info:async()=>({ok:true,file})}},{accessToken:'private-token',fetchImpl:async(url,opts)=>{called++;assert.equal(url,file.url_private);assert.equal(opts.headers.Authorization,'Bearer private-token');assert.equal(opts.redirect,'error');return new Response(png);}});
 assert.deepEqual(await client.getImage('F123'),png);assert.equal(called,1);
 const bad=createSlackClient({files:{info:async()=>({ok:true,file:{...file,url_private:'https://attacker.example/file'}})}},{accessToken:'secret',fetchImpl:async()=>{throw Error('must not fetch')}});
 await assert.rejects(bad.getImage('F123'),e=>e.code==='PROVIDER_ERROR'&&!e.message.includes('secret'));
});
test('Slack画像の容量超過・権限不足は画面用の案内を保存する',async t=>{
 for(const [code,pattern]of[['IMAGE_TOO_LARGE',/1MB/],['SLACK_FILE_PERMISSION',/files:read/]]){
  const f=await setup(t,async()=>{const e=Error('secret');e.code=code;throw e;});await f.handle({event});await f.handle({event});
  const m=f.store.read().messages;assert.equal(m.length,1);assert.equal(m[0].messageType,'other');assert.match(m[0].text,pattern);assert.ok(!m[0].text.includes('secret'));
 }
});
test('Slack画像のサイズ事前確認とストリーム上限、files:read不足を識別する',async()=>{
 const large=createSlackClient({files:{info:async()=>({ok:true,file:{...file,size:1024*1024+1}})}},{accessToken:'secret'});
 await assert.rejects(large.getImage('F123'),e=>e.code==='IMAGE_TOO_LARGE');
 const missing=createSlackClient({files:{info:async()=>{throw {data:{error:'missing_scope'}};}}});
 await assert.rejects(missing.getImage('F123'),e=>e.code==='SLACK_FILE_PERMISSION');
 const streamed=createSlackClient({files:{info:async()=>({ok:true,file})}},{accessToken:'secret',fetchImpl:async()=>new Response(new Uint8Array(1024*1024+1))});
 await assert.rejects(streamed.getImage('F123'),e=>e.code==='IMAGE_TOO_LARGE');
});
