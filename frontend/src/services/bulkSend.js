/* 一度の確認につき各会話へ一回だけ。結果不明の宛先を自動再送しない。 */
function validateRecipients(recipients) {
  if (!Array.isArray(recipients) || !recipients.length ||
      recipients.some(row => typeof row.conversationId !== 'string' || !row.conversationId) ||
      new Set(recipients.map(row => row.conversationId)).size !== recipients.length) throw new Error('宛先を確認してください。');
}
async function sendEach(recipients, send, onResult) {
  const results = [];
  for (const recipient of recipients) {
    let result;
    try {
      await send(recipient);
      result = { ...recipient, status: 'sent' };
    } catch (error) {
      const unknown = error.code === 'DELIVERY_UNKNOWN' || !error.code || ['NETWORK_ERROR', 'INVALID_RESPONSE'].includes(error.code);
      result = { ...recipient, status: unknown ? 'unknown' : 'failed',
        message: unknown ? '結果不明：送信先で確認してください。自動再送はしません。' : error.message || '送信できませんでした。' };
    }
    results.push(result); onResult(result);
  }
  return results;
}
export async function sendBulkText(recipients, text, send, onResult = () => {}) {
  validateRecipients(recipients);
  if (typeof text !== 'string' || !text.trim() || text.length > 5000) throw new Error('本文を確認してください。');
  return sendEach(recipients, recipient => send({ conversationId: recipient.conversationId, text }), onResult);
}
export async function sendBulkImage(recipients, file, send, onResult = () => {}) {
  validateRecipients(recipients);
  if (!file || !['image/jpeg', 'image/png'].includes(file.type) || !file.size || file.size > 1024 * 1024) throw new Error('JPEG・PNGの1MB以下の画像を選んでください。');
  return sendEach(recipients, recipient => send(recipient.conversationId, file), onResult);
}
