/* 日本語の表記揺れと、登録済みの読み・別表記を検証する。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesContact } from '../src/services/contactSearch.js';
test('ひらがな・カタカナ・半角カナ・空白を同一視する', () => {
 for(const query of ['まひろ','マヒロ','ﾏﾋﾛ','ま ひろ'])assert.equal(matchesContact({displayName:'マヒロ'},query),true);
 assert.equal(matchesContact({displayName:'Alice Smith'},'ALICE　SMITH'),true);
 assert.equal(matchesContact({displayName:'まひろ'},'ひろき'),false);
 assert.equal(matchesContact({displayName:'岡林真広'},'岡林'),true);
});
test('登録した読みと漢字の別表記を両方向に検索できる', () => {
 assert.equal(matchesContact({displayName:'岡林真広',searchName:'おかばやしまひろ'},'オカバヤシ'),true);
 assert.equal(matchesContact({displayName:'まひろ',searchName:'岡林真広'},'岡林'),true);
 assert.equal(matchesContact({displayName:'岡林真広'},'まひろ'),false);
 assert.equal(matchesContact({displayName:'まひろ'},''),true);
});
