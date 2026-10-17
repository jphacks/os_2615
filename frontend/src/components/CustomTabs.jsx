/* タブ作成・相手の登録と解除。保存成功後に親画面を更新する。 */
import React, { useEffect, useRef, useState } from 'react';
import { matchesContact } from '../services/contactSearch.js';
import { api } from '../services/api.js';
export default function CustomTabs({ tabs, items, filter, onSelect, onRefresh, creating, onCloseCreate, showOrderControls = true }) {
  const [expanded, setExpanded] = useState(false);
  const nameInput = useRef(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [search, setSearch] = useState('');
  const selected = tabs.find(tab => `tab:${tab.id}` === filter);
  useEffect(() => { setConfirmDelete(false); setSearch(''); setError(''); setExpanded(false); }, [selected?.id]);
  useEffect(() => {
    if (creating) { setExpanded(true); }
  }, [creating, selected?.id]);
  useEffect(() => { if (creating && expanded) nameInput.current?.focus(); }, [creating, expanded]);
  async function run(operation) {
    if (busy) return;
    setBusy(true); setError('');
    try { await operation(); await onRefresh(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  if (!selected && !creating) return null;
  return <div className={`custom-tab-tools ${expanded ? 'is-open' : ''}`}>
      <button type="button" className="tab-editor-toggle" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? '▼' : '▶'} {selected ? `${selected.name}を編集` : '＋ タブを追加'}</button>
      {expanded && <div className="tab-editor-body">
      {error && <p role="alert">{error}</p>}
      {creating && <form onSubmit={e => {
        e.preventDefault();
        run(async () => { const result = await api.createTab(name); setName(''); onCloseCreate(); onSelect(`tab:${result.data.id}`); });
      }}>
        <label>新しいタブ名<input ref={nameInput} value={name} maxLength={40} onChange={e => setName(e.target.value)} placeholder="例：サークル、仕事" disabled={busy} /></label>
        <button disabled={busy || !name.trim()}>タブを作成</button>
        <button type="button" disabled={busy} onClick={onCloseCreate}>キャンセル</button>
      </form>}
      {selected && <>
        {showOrderControls && <div className="tab-order-controls" role="group" aria-label="タブの並び順">
          <div className="tab-order-heading">
            <span>並び順</span>
            <small aria-live="polite">{tabs.findIndex(tab => tab.id === selected.id) + 1} / {tabs.length}</small>
          </div>
          <div className="tab-order-buttons">
          <button type="button" disabled={busy || tabs[0]?.id === selected.id} onClick={() => run(() => api.moveTab(selected.id, 'first'))}>一番前へ</button>
          <button type="button" disabled={busy || tabs[0]?.id === selected.id} onClick={() => run(() => api.moveTab(selected.id, 'previous'))}>← 前へ</button>
          <button type="button" disabled={busy || tabs[tabs.length - 1]?.id === selected.id} onClick={() => run(() => api.moveTab(selected.id, 'next'))}>後へ →</button>
          <button type="button" disabled={busy || tabs[tabs.length - 1]?.id === selected.id} onClick={() => run(() => api.moveTab(selected.id, 'last'))}>一番後ろへ</button>
          </div>
        </div>}
        <div className="tab-member-scroll" role="region" aria-label="タブに登録する相手" tabIndex={0}>
        <p>このタブに表示する相手を選んでください。複数のタブに登録できます。</p>
        <label>相手を検索<input value={search} onChange={e => setSearch(e.target.value)} placeholder="名前で検索" /></label>
        <div className="tab-member-list">
          {items.filter(item => matchesContact(item.contact, search)).map(({ contact }) => <label key={contact.id}>
            <input type="checkbox" disabled={busy} checked={selected.contactIds.includes(contact.id)} onChange={e => {
              const included = e.target.checked;
              run(() => api.tabMember(selected.id, contact.id, included));
            }} />
            <span>{contact.displayName} <small>{contact.platform === 'line' ? 'LINE' : 'Slack'}</small></span>
          </label>)}
          {!items.length && <p>メッセージを受信すると、登録できる相手が表示されます。</p>}
        </div>
        {confirmDelete ? <div>
          <p>このタブを削除しますか？相手と会話履歴は残ります。</p>
          <button type="button" disabled={busy} onClick={() => run(async () => { await api.deleteTab(selected.id); onSelect('all'); })}>削除する</button>
          <button type="button" disabled={busy} onClick={() => setConfirmDelete(false)}>キャンセル</button>
        </div> : <button type="button" disabled={busy} onClick={() => setConfirmDelete(true)}>このタブを削除</button>}
        </div>
      </>}
      </div>}
  </div>;
}
