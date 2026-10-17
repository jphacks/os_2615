import test from 'node:test';
import assert from 'node:assert/strict';
import { tabSlotIndex, tabOrderAt } from '../src/services/tabDrag.js';
test('固定した位置を基準に、先頭から末尾まで安定して並び替える', () => {
 const centers=[50,150,250],original=['a','b','c'];
 assert.equal(tabSlotIndex(centers,50),0);
 assert.equal(tabSlotIndex(centers,151),1);
 assert.equal(tabSlotIndex(centers,251),2);
 const result=tabOrderAt(original,'a',tabSlotIndex(centers,251));
 assert.deepEqual(result,['b','c','a']);
 for(let i=0;i<20;i++)assert.deepEqual(tabOrderAt(original,'a',tabSlotIndex(centers,251)),result);
 assert.deepEqual(original,['a','b','c']);
 assert.deepEqual(tabOrderAt(original,'c',0),['c','a','b']);
});
test('スクロール後の座標補正と範囲外の位置を扱う',()=>{
 const centers=[300,400,500];
 assert.equal(tabSlotIndex(centers,390+120),2);
 assert.equal(tabSlotIndex(centers,-1000),0);
 assert.equal(tabSlotIndex(centers,1000),2);
 assert.deepEqual(tabOrderAt(['a','b','c'],'a',999),['b','c','a']);
 assert.deepEqual(tabOrderAt(['a','b','c'],'b',-1),['b','a','c']);
});
