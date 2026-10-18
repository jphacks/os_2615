import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Send, X } from 'lucide-react';
import { api } from '../services/api.js';
import { sendBulkText, sendBulkImage } from '../services/bulkSend.js';

export default function BulkSend({ tab, items, onRefresh }) {
  const [batch, setBatch] = useState(null);
  if (!tab) return null;
  const members = items.filter(item => tab.contactIds.includes(item.contact.id));
  return <div className="bulk-send-toolbar">
    <button type="button" disabled={!members.length} onClick={() => setBatch({ name: tab.name,
      recipients: members.map(item => ({ contactId: item.contact.id, conversationId: item.conversation.id, name: item.contact.displayName, platform: item.contact.platform })) })}>
      <Send size={15} aria-hidden="true" /> タブの相手に一括送信
    </button>
    {batch && createPortal(<BulkDialog batch={batch} onClose={() => setBatch(null)} onRefresh={onRefresh} />, document.body)}
  </div>;
}
function BulkDialog({ batch, onClose, onRefresh }) {
  const dialog = useRef(null), sending = useRef(false), restoreFocus = useRef(document.activeElement);
  const [selected, setSelected] = useState(() => new Set(batch.recipients.map(row => row.contactId)));
  const [mode, setMode] = useState('text'), [file, setFile] = useState(null), [preview, setPreview] = useState('');
  const [text, setText] = useState(''), [step, setStep] = useState('compose');
  const [results, setResults] = useState([]), [error, setError] = useState('');
  const recipients = batch.recipients.filter(row => selected.has(row.contactId));
  const valid = recipients.length > 0 && (mode === 'image' ? Boolean(file) : text.trim() && text.length <= 5000);
  useEffect(() => {
    if (!file) { setPreview(''); return; }
    const url = URL.createObjectURL(file); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => { dialog.current.showModal(); return () => restoreFocus.current?.focus(); }, []);
  useEffect(() => {
    if (step !== 'sending') return;
    const warn = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [step]);
  async function send() {
    if (sending.current || step !== 'confirm' || !valid) return;
    sending.current = true; setStep('sending'); setResults([]); setError('');
    try {
      const received = result => setResults(current => [...current, result]);
      if (mode === 'image') await sendBulkImage(recipients, file, api.replyImage, received);
      else await sendBulkText(recipients, text, api.reply, received);
    } catch (failure) { setError(failure.message); }
    finally {
      sending.current = false; setStep('done');
      try { await onRefresh(); } catch { setError('送信結果は下記のとおりです。一覧を更新できませんでした。閉じてから再読み込みしてください。'); }
    }
  }
  const sent = results.filter(row => row.status === 'sent').length;
  return <dialog ref={dialog} className="settings-dialog bulk-send-dialog" aria-labelledby="bulk-title"
    onCancel={event => { if (sending.current) event.preventDefault(); }} onClose={onClose}>
    <header><h2 id="bulk-title">{batch.name}：一括送信</h2><button type="button" aria-label="一括送信を閉じる" disabled={step === 'sending'} onClick={() => dialog.current.close()}><X size={22} /></button></header>
    {step === 'compose' ? <>
      <p>このタブの相手から宛先を選んでください。検索・サービスフィルタに関係なく、タブ内の相手を表示しています。</p>
      <div className="bulk-selection-tools"><button type="button" onClick={() => setSelected(new Set(batch.recipients.map(row => row.contactId)))}>全員を選択</button><button type="button" onClick={() => setSelected(new Set())}>選択を解除</button><span>{recipients.length}人を選択中</span></div>
      <div className="bulk-recipients" role="group" aria-label="一括送信の宛先">
        {batch.recipients.map(row => <label key={row.contactId}><input type="checkbox" checked={selected.has(row.contactId)} onChange={() => setSelected(current => { const next = new Set(current); if (next.has(row.contactId)) next.delete(row.contactId); else next.add(row.contactId); return next; })} /><span>{row.name}</span><small>{row.platform === 'line' ? 'LINE' : 'Slack'}</small></label>)}
      </div>
      <div className="bulk-mode" role="group" aria-label="一括送信する内容">
        <label><input type="radio" name="bulk-mode" checked={mode === 'text'} onChange={() => { setMode('text'); setError(''); }} />文章</label>
        <label><input type="radio" name="bulk-mode" checked={mode === 'image'} onChange={() => { setMode('image'); setError(''); }} />画像</label>
      </div>
      {mode === 'text' ? <><label className="bulk-text-label">送信する文章<textarea aria-label="一括送信の本文" value={text} maxLength={5000} rows={5} onChange={event => setText(event.target.value)} /></label><small>{text.length} / 5000</small></> : <>
        <label className="bulk-file-label">送信する画像（JPEG・PNG／1MBまで）<input aria-label="一括送信の画像" type="file" accept="image/jpeg,image/png" onChange={event => {
          const chosen = event.target.files?.[0]; event.target.value = ''; if (!chosen) return;
          if (!['image/jpeg', 'image/png'].includes(chosen.type) || !chosen.size || chosen.size > 1024 * 1024) { setError('JPEG・PNGの1MB以下の画像を選んでください。'); return; }
          setError(''); setFile(chosen);
        }} /></label>
        {file && <div className="bulk-image-preview">{preview && <img src={preview} alt="一括送信する画像のプレビュー" />}<p>{file.name}</p><button type="button" onClick={() => setFile(null)}>画像を取り消す</button></div>}
      </>}
      <p>同じ{mode === 'image' ? '画像' : '文章'}をそれぞれの会話に送ります。文章と画像は別々に送信してください。予約送信は対象外です。</p>
      <footer><button type="button" onClick={() => dialog.current.close()}>キャンセル</button><button type="button" disabled={!valid} onClick={() => setStep('confirm')}>宛先と{mode === 'image' ? '画像' : '本文'}を確認</button></footer>
    </> : <>
      <p>{step === 'confirm' ? `${recipients.length}人に以下の${mode === 'image' ? '画像' : '文章'}を送信します。送信後は取り消せません。` : step === 'sending' ? `送信中… ${results.length} / ${recipients.length}人。この画面を閉じずにお待ちください。` : `送信完了：成功 ${sent}人／未送信・結果不明 ${results.length - sent}人`}</p>
      <ul className="bulk-recipients bulk-recipient-summary">{recipients.map(row => <li key={row.contactId}>{row.name}（{row.platform === 'line' ? 'LINE' : 'Slack'}）</li>)}</ul>
      <div className="bulk-preview">{mode === 'image' ? <div className="bulk-image-preview">{preview && <img src={preview} alt="送信確認用の画像" />}<p>{file?.name}</p></div> : text}</div>
      {step === 'confirm' ? <footer><button type="button" onClick={() => setStep('compose')}>編集に戻る</button><button type="button" onClick={send}>{recipients.length}人に送信する</button></footer> : <>
        <ul className="bulk-results" aria-live="polite">{results.map(row => <li key={row.contactId}><strong>{row.name}：{row.status === 'sent' ? '送信済み' : row.status === 'unknown' ? '結果不明' : '送信失敗'}</strong>{row.message && <p>{row.message}</p>}</li>)}</ul>
        {step === 'done' && <><p>失敗・結果不明の宛先は、個別の会話で確認してください。送信済みの相手への自動再送は行いません。</p><footer><button type="button" onClick={() => dialog.current.close()}>閉じる</button></footer></>}
      </>}
    </>}
    {error && <p role="alert">{error}</p>}
  </dialog>;
}
