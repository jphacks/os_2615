/* 検索用の名前の入力検証・永続化・受信後の保持を検証する。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJsonStore } from '../src/repositories/jsonStore.js';
import { createContactRepository } from '../src/repositories/contactRepository.js';
import { createContactService } from '../src/services/contactService.js';
import { createMessageRepository } from '../src/repositories/messageRepository.js';
import { demoState } from './fixtures/demoState.js';
test('検索名を保存して再起動・新着後も保持し、解除できる',async t=>{
 const dir=await fs.mkdtemp(join(tmpdir(),'konekuto-search-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const path=join(dir,'store.json');const store=await createJsonStore(path);
 await store.update(state=>Object.assign(state,demoState()));
 const service=createContactService(createContactRepository(store));
 const before=store.read();
 await service.setSearchName('demo-contact-line',{searchName:' やまだ 山田 '});
 assert.equal((await createJsonStore(path)).read().contacts[0].searchName,'やまだ 山田');
 const message={...before.messages[0],platformMessageId:'new-name-search',timestamp:new Date().toISOString()};
 await createMessageRepository(store).receive({platform:'line',platformUserId:'demo-user-line',platformConversationId:'demo-destination-line',displayName:'新しい名前',message});
 assert.equal(store.read().contacts[0].searchName,'やまだ 山田');
 assert.equal(store.read().contacts[0].displayName,'新しい名前');
 for(const body of [null,[],{}, {searchName:1},{searchName:'a'.repeat(101)}, {searchName:'a',extra:1}])assert.throws(()=>service.setSearchName('demo-contact-line',body),e=>e.status===400);
 await assert.rejects(service.setSearchName('missing',{searchName:'あ'}),e=>e.status===404);
 await service.setSearchName('demo-contact-line',{searchName:''});
 assert.equal(store.read().contacts[0].searchName,'');
});
