import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createSplitStore} from '../src/repositories/splitStore.js';
import {createMediaRepository} from '../src/repositories/mediaRepository.js';
import {createMessageRepository} from '../src/repositories/messageRepository.js';
import {createReplyService} from '../src/services/replyService.js';
import {createHistoryService} from '../src/services/historyService.js';
import {createApp} from '../src/app.js';
import {demoState} from './fixtures/demoState.js';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=','base64');
const now=Date.parse('2026-11-16T01:00:00Z');
async function setup(t) {
 const dir=await fs.mkdtemp(join(tmpdir(),'konekuto-history-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const path=join(dir,'store.json');await fs.writeFile(path,JSON.stringify(demoState()));
 const store=await createSplitStore(path), media=createMediaRepository(join(dir,'media'));
 const replies=createReplyService(createMessageRepository(store),{});
 const service=createHistoryService(store,media,replies,{now:()=>now});t.after(()=>service.stop());
 return {store,media,replies,service,path,dir};
}
test('履歴と画像を削除しても人物・所属・送信待ち予約を保持し、空履歴を再読込できる',async t=>{
 const f=await setup(t), image=await f.media.save(png,'line');
 await f.store.update(s=>{
  const m=s.messages[0];m.messageType='image';m.media=image;
  s.tabs=[{id:'tab',name:'仕事',contactIds:[s.contacts[0].id]}];
  s.reminders=[{id:'rem',conversationId:m.conversationId,messageId:m.id,remindAt:'2026-12-01T00:00:00Z',status:'pending'}];
  s.scheduledMessages=['pending','sent'].map((status,i)=>({id:'job'+i,conversationId:m.conversationId,text:'予約',status,sendAt:'2026-12-01T00:00:00Z',createdAt:m.timestamp}));
 });
 const before=f.store.read();const r=await f.service.clear(before.contacts[0].id,{lastMessageId:before.messages[0].id,messageCount:1});
 assert.equal(r.deletedMessages,1);assert.equal(r.cleanupPending,false);
 const after=f.store.read();assert.deepEqual(after.contacts,before.contacts);assert.deepEqual(after.tabs,before.tabs);
 assert.equal(after.conversations[0].lastMessageId,null);assert.equal(after.conversations[0].hasUnreplied,false);
 assert.equal(after.reminders.length,0);assert.equal(after.scheduledMessages.length,1);assert.equal(after.scheduledMessages[0].status,'pending');
 await assert.rejects(f.media.read(image.id),e=>e.status===404);
 assert.deepEqual((await createSplitStore(f.path)).read(),after);
 const repo=createMessageRepository(f.store);await repo.receive({platform:'line',platformUserId:'demo-user-line',platformConversationId:'demo-destination-line',displayName:null,message:{...before.messages[0],messageType:'text',media:undefined,platformMessageId:'new',timestamp:new Date(now).toISOString(),text:'新着'}});
 assert.equal(f.store.read().contacts.length,2);assert.equal(f.store.read().conversations[0].hasUnreplied,true);
});
test('30日境界の履歴を削除し新しい画像とメッセージを保持する',async t=>{
 const f=await setup(t), image=await f.media.save(png,'line');
 await f.store.update(s=>{s.messages.push({...s.messages[0],id:'new',platformMessageId:'new',timestamp:new Date(now-1000).toISOString(),messageType:'image',media:image});s.conversations[0].lastMessageId='new';});
 await f.service.run();const s=f.store.read();assert.deepEqual(s.messages.map(m=>m.id),['new']);assert.equal(s.conversations[1].lastMessageId,null);assert.equal(s.conversations[0].lastMessageId,'new');
 assert.deepEqual((await f.media.read(image.id)).bytes,png);assert.deepEqual((await createSplitStore(f.path)).read(),s);
});
test('古い画面・送信中・保存失敗では履歴と画像を消さない',async t=>{
 const f=await setup(t);const original=f.store.read();const snapshot={lastMessageId:original.messages[0].id,messageCount:1};
 await assert.rejects(f.service.clear(original.contacts[0].id,{...snapshot,messageCount:0}),e=>e.status===409);
 let release;const hold=new Promise(r=>release=r);const lock=f.replies.withConversationLock(original.conversations[0].id,()=>hold);
 await assert.rejects(f.service.clear(original.contacts[0].id,snapshot),e=>e.code==='REPLY_IN_PROGRESS');release();await lock;
 const update=f.store.update;f.store.update=()=>Promise.reject(Error('disk'));await assert.rejects(f.service.clear(original.contacts[0].id,snapshot));f.store.update=update;
 assert.deepEqual(f.store.read(),original);
});
test('参照されない古い画像だけを回収し、参照中・保存直後は残す',async t=>{
 const f=await setup(t), referenced=await f.media.save(png,'line'), orphan=await f.media.save(png,'slack'), fresh=await f.media.save(png,'line');
 await fs.utimes(join(f.dir,'media','line',fresh.id),new Date(now),new Date(now));
 const old=new Date(now-2*86400000);for(const [platform,img]of[['line',referenced],['slack',orphan]])await fs.utimes(join(f.dir,'media',platform,img.id),old,old);
 await f.media.pruneOrphans(()=>new Set([referenced.id]),now-86400000);
 await assert.rejects(f.media.read(orphan.id),e=>e.status===404);await f.media.read(referenced.id);await f.media.read(fresh.id);
});
test('削除APIは明示的な履歴スナップショットを検証し保存方針を返す',async t=>{
 const f=await setup(t),server=createApp(f.store,{providers:{},mediaRepository:f.media}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
 const url=`http://127.0.0.1:${server.address().port}`;
 assert.equal((await (await fetch(url+'/api/data-policy')).json()).data.retentionDays,30);
 const del=body=>fetch(url+'/api/contacts/demo-contact-line/messages',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 for(const body of [{},{lastMessageId:'x',messageCount:-1},{lastMessageId:'x',messageCount:1,extra:1}])assert.equal((await del(body)).status,400);
 assert.equal((await del({lastMessageId:'demo-message-line',messageCount:1})).status,200);
 assert.equal((await (await fetch(url+'/api/contacts/demo-contact-line/messages')).json()).data.messages.length,0);
});

test('画像削除失敗は確定済みの履歴削除を戻さず再試行待ちを返す',async t=>{
 const f=await setup(t), image=await f.media.save(png,'line');
 await f.store.update(s=>{s.messages[0].messageType='image';s.messages[0].media=image;});
 const remove=f.media.remove;f.media.remove=async()=>{throw Error('disk')};
 const r=await f.service.clear('demo-contact-line',{lastMessageId:'demo-message-line',messageCount:1});
 assert.equal(r.cleanupPending,true);assert.equal(f.store.read().messages.length,1);await f.media.read(image.id);f.media.remove=remove;
 const old=new Date(now-2*86400000);await fs.utimes(join(f.dir,'media','line',image.id),old,old);await f.service.run();await assert.rejects(f.media.read(image.id),e=>e.status===404);
});

test('人物完全削除は他人物・タブ自体を保ち、所属と全予約を削除する',async t=>{
 const f=await setup(t), image=await f.media.save(png,'line');
 await f.store.update(s=>{
  s.messages[0].messageType='image';s.messages[0].media=image;
  s.tabs=[{id:'work',name:'仕事',contactIds:s.contacts.map(p=>p.id)}];
  s.scheduledMessages=['pending','sent'].map((status,i)=>({id:'j'+i,conversationId:'demo-conversation-line',text:'予約',status,sendAt:'2026-12-01T00:00:00Z',createdAt:s.messages[0].timestamp}));
 });
 await f.service.clear('demo-contact-line',{lastMessageId:'demo-message-line',messageCount:1},true);
 const s=f.store.read();assert.deepEqual(s.contacts.map(p=>p.id),['demo-contact-slack']);assert.equal(s.messages.length,1);assert.equal(s.conversations.length,1);assert.deepEqual(s.scheduledMessages,[]);
 assert.deepEqual(s.tabs,[{id:'work',name:'仕事',contactIds:['demo-contact-slack']}]);await assert.rejects(f.media.read(image.id),e=>e.status===404);
 assert.deepEqual((await createSplitStore(f.path)).read(),s);
});
test('人物完全削除APIは古い画面・不正本文を拒否し、空の人物も削除できる',async t=>{
 const f=await setup(t),server=createApp(f.store,{providers:{},mediaRepository:f.media}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
 const url=`http://127.0.0.1:${server.address().port}/api/contacts/demo-contact-line`;
 const del=body=>fetch(url,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await del({})).status,400);assert.equal((await del({lastMessageId:'old',messageCount:1})).status,409);
 await f.service.clear('demo-contact-line',{lastMessageId:'demo-message-line',messageCount:1});
 assert.equal((await del({lastMessageId:null,messageCount:0})).status,200);
 assert.equal((await del({lastMessageId:null,messageCount:0})).status,404);
});

test('人物名変更APIはローカル表示名を保持し、新着で外部名に戻らない',async t=>{
 const f=await setup(t),server=createApp(f.store,{providers:{},mediaRepository:f.media}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
 const url=`http://127.0.0.1:${server.address().port}/api/contacts/demo-contact-line/name`;
 const rename=body=>fetch(url,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 for(const body of [{},{name:'a'.repeat(101)},{name:'x',extra:1}])assert.equal((await rename(body)).status,400);
 assert.equal((await rename({name:'  仕事の窓口  '})).status,200);
 const before=f.store.read();assert.equal(before.contacts[0].displayName,'仕事の窓口');assert.equal(before.contacts[0].platformUserId,'demo-user-line');
 await createMessageRepository(f.store).receive({platform:'line',platformUserId:'demo-user-line',platformConversationId:'demo-destination-line',displayName:'外部での名前',message:{...before.messages[0],platformMessageId:'rename-new',timestamp:new Date(now).toISOString(),text:'新着'}});
 assert.equal(f.store.read().contacts[0].displayName,'仕事の窓口');assert.equal((await createSplitStore(f.path)).read().contacts[0].displayName,'仕事の窓口');
});

test('空欄保存で初期名へ戻り、再変更・再起動後も初期名を保持する',async t=>{
 const f=await setup(t);
 const {createContactRepository}=await import('../src/repositories/contactRepository.js');
 const repo=createContactRepository(f.store);
 await repo.rename('demo-contact-line','別名');
 assert.equal(repo.listInbox()[0].contact.initialName,'山田');
 await repo.rename('demo-contact-line','');
 assert.equal(f.store.read().contacts[0].displayName,'山田');assert.equal(f.store.read().contacts[0].nameOverridden,false);
 await repo.rename('demo-contact-line','別名2');await repo.rename('demo-contact-line','');
 assert.equal((await createSplitStore(f.path)).read().contacts[0].displayName,'山田');
});
