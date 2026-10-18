import React, {useId, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {Trash2} from 'lucide-react';
import {api} from '../services/api.js';
export default function DeleteHistory({contactId, name, messages, lastMessageId, disabled, onDeleted, complete = false, triggerLabel}) {
 const titleId=useId();
 const title=complete ? '人物を完全削除' : 'トーク履歴を削除';
 const dialog=useRef(null), [busy,setBusy]=useState(false), [error,setError]=useState(''), snapshot=useRef(null);
 async function remove(event) {
  event.preventDefault();event.stopPropagation();if(busy)return;
  setBusy(true);setError('');
  try {const result=await (complete ? api.deleteContact : api.deleteHistory)(contactId,snapshot.current);dialog.current.close();await onDeleted(result.data);}
  catch(e){setError(e.message);} finally{setBusy(false);}
 }
 return <>
  <button type="button" className={triggerLabel ? 'contact-menu-action' : `icon-button delete-history ${complete ? 'delete-contact' : ''}`} aria-label={triggerLabel || (complete ? `${name}さんをこねくとから削除` : 'この相手のトーク履歴を削除')} title={title} disabled={disabled||busy||(!complete&&messages&& !messages.length)} onClick={async()=>{
    setError('');dialog.current.showModal();
    if (messages) { snapshot.current={lastMessageId,messageCount:messages.length}; return; }
    snapshot.current=null;setBusy(true);
    try { const r=await api.messages(contactId);snapshot.current={lastMessageId:r.data.conversation.lastMessageId,messageCount:r.data.messages.length}; }
    catch(e){setError(e.message);} finally{setBusy(false);}
  }}>{triggerLabel || <Trash2 size={17}/>}</button>
  {createPortal(<dialog ref={dialog} className="settings-dialog delete-history-dialog" aria-labelledby={titleId} onCancel={e=>{if(busy)e.preventDefault();}}>
   <h2 id={titleId}>{title}</h2>
   <p>{name}さんとの、こねくと内のメッセージと画像を削除します。元に戻せません。</p>
   <p>{complete ? '人物登録、すべてのタブ所属、履歴・画像、リマインダー、送信待ちを含む予約を削除します。LINE・Slack側の履歴は変更しません。新しいメッセージが届くと再び人物が登録されます。' : 'LINE・Slack側の履歴、人物登録、タブ所属、送信待ち予約は残ります。履歴に紐づくリマインダーと完了した予約の表示は削除します。'}</p>
   {error&&<p role="alert">{error}</p>}
   <form onSubmit={remove}><footer><button type="button" disabled={busy} onClick={()=>dialog.current.close()}>キャンセル</button><button className="destructive" disabled={busy||!snapshot.current}>{busy?'処理中…':complete?'人物とデータを削除する':'履歴を削除する'}</button></footer></form>
  </dialog>,document.body)}
 </>;
}
