/* 検索に使う読み・別表記をContactに保存する。外部サービス上の名前は変えない。 */
import React, { useState } from 'react';
import { api } from '../services/api.js';
export default function ContactSearchName({ contact, onRefresh }) {
  const [value, setValue] = useState(contact.searchName ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  return <details className="contact-search-name">
    <summary>検索用の名前を設定</summary>
    <form onSubmit={async e => {
      e.preventDefault(); if (busy) return; setBusy(true); setError(''); setSaved(false);
      try { await api.searchName(contact.id, value); setSaved(true); await onRefresh(); }
      catch(e) { setError(e.message); }
      finally { setBusy(false); }
    }}>
      <label>よみがな・別表記<input value={value} maxLength={100} onChange={e => { setValue(e.target.value); setSaved(false); }} disabled={busy} placeholder="例：おかばやしまひろ 岡林真広" /></label>
      <p>漢字名にはよみがな、かな名には漢字の別表記を登録できます。空欄で保存すると解除します。</p>
      <button disabled={busy}>{busy ? '保存中…' : '保存'}</button>
      {error && <p role="alert">{error}</p>}
      {saved && <p role="status">検索用の名前を保存しました</p>}
    </form>
  </details>;
}
