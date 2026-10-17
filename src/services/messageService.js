/*
共通会話履歴の取得を担当する。受信・返信の保存処理はProvider統合時に追加する。
*/
import { notFound } from '../utils/errors.js';

export function createMessageService(repository) {
  return {
    history(contactId) {
      const history = repository.findHistory(contactId);
      if (!history) throw notFound();
      return history;
    }
  };
}
