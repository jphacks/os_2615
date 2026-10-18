import test from 'node:test';
import assert from 'node:assert/strict';
import { sendBulkText } from '../src/services/bulkSend.js';
const recipients = [1, 2, 3].map(id => ({ contactId: `c${id}`, conversationId: `v${id}`, name: `相手${id}` }));
test('選択した会話へ同じ本文を一度ずつ順番に送る', async () => {
  const calls = [], results = [];
  let active = 0;
  const result = await sendBulkText([recipients[0], recipients[2]], '一斉案内', async body => {
    assert.equal(active++, 0); await Promise.resolve(); calls.push(body); active--;
  }, row => results.push(row));
  assert.deepEqual(calls, [{ conversationId: 'v1', text: '一斉案内' }, { conversationId: 'v3', text: '一斉案内' }]);
  assert.deepEqual(result.map(row => row.status), ['sent', 'sent']); assert.equal(results.length, 2);
});
test('失敗しても残りへ送信し、結果不明は自動再送しない', async () => {
  let calls = 0;
  const results = await sendBulkText(recipients, '案内', async ({ conversationId }) => {
    calls++; if (conversationId === 'v1') throw { code: 'DELIVERY_UNKNOWN' };
    if (conversationId === 'v2') throw { code: 'PROVIDER_NOT_CONFIGURED', message: 'サービス未設定' };
  });
  assert.deepEqual(results.map(row => row.status), ['unknown', 'failed', 'sent']); assert.equal(calls, 3);
});
test('空の宛先・本文・重複会話・文字数超過は外部送信前に拒否', async () => {
  let calls = 0;
  for (const [to, text] of [[[], '本文'], [recipients, ' '], [[recipients[0], recipients[0]], '本文'], [recipients, 'a'.repeat(5001)]]) {
    await assert.rejects(sendBulkText(to, text, async () => { calls++; }));
  }
  assert.equal(calls, 0);
});

test('画像を選択した会話へ一度ずつ送り、同じファイルを使用する', async () => {
  const { sendBulkImage } = await import('../src/services/bulkSend.js');
  const file = { type: 'image/png', size: 120 };
  const calls = [];
  const results = await sendBulkImage(recipients, file, async (id, image) => { calls.push(id); assert.equal(image, file); });
  assert.deepEqual(calls, ['v1', 'v2', 'v3']); assert.ok(results.every(row => row.status === 'sent'));
  for (const invalid of [null, { type: 'image/svg+xml', size: 20 }, { type: 'image/png', size: 1024 * 1024 + 1 }]) {
    await assert.rejects(sendBulkImage(recipients, invalid, async () => { throw new Error('must not call'); }));
  }
});
test('画像送信失敗・結果不明でも残りの相手への送信を継続する', async () => {
  const { sendBulkImage } = await import('../src/services/bulkSend.js');
  let calls = 0;
  const results = await sendBulkImage(recipients, { type: 'image/jpeg', size: 50 }, async id => {
    calls++; if (id === 'v1') throw { code: 'SLACK_FILE_WRITE_PERMISSION', message: 'files:writeが必要' };
    if (id === 'v2') throw { code: 'DELIVERY_UNKNOWN' };
  });
  assert.equal(calls, 3); assert.deepEqual(results.map(row => row.status), ['failed', 'unknown', 'sent']);
});
