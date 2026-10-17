import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings, readSettings, writeSettings, SETTINGS_KEY } from '../src/services/settings.js';
test('保存した表示設定の復元・破損時の既定値・保存失敗を扱う', () => {
 const values = new Map();const storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
 assert.deepEqual(readSettings(storage),{theme:'system',fontSize:'normal'});
 assert.equal(writeSettings(storage,{theme:'dark',fontSize:'extra-large'}),true);
 assert.deepEqual(readSettings(storage),{theme:'dark',fontSize:'extra-large'});
 values.set(SETTINGS_KEY,'{broken');assert.equal(readSettings(storage).theme,'system');
 assert.deepEqual(normalizeSettings({theme:'unexpected',fontSize:100}),{theme:'system',fontSize:'normal'});
 assert.equal(writeSettings({setItem(){throw Error('blocked');}},{theme:'light',fontSize:'large'}),false);
});
