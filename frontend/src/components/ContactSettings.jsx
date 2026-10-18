import React, {useId, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {UserRoundCog, X} from 'lucide-react';
import {api} from '../services/api.js';
import DeleteHistory from './DeleteHistory.jsx';
export default function ContactSettings({contact,disabled,onChanged,onDeleted}) {
 const dialog=useRef(null), title=useId();
 const [opened,setOpened]=useState(false);
 useLayoutEffect(()=>{if(opened)dialog.current?.showModal();},[opened]);
 const [name,setName]=useState(''), [busy,setBusy]=useState(false), [error,setError]=useState('');
 async function rename(event) {
  event.preventDefault();event.stopPropagation();if(busy)return;
  setBusy(true);setError('');
  try {await api.renameContact(contact.id,name);await onChanged();dialog.current.close();}
  catch(e){setError(e.message);}finally{setBusy(false);}
 }
 return <>
  <button type="button" className="icon-button contact-settings-trigger" title="人物の設定" aria-label={`${contact.displayName}さんの人物設定`} disabled={disabled} onClick={()=>{setName(contact.displayName);setError('');setOpened(true);}}><UserRoundCog size={19}/></button>
  {opened && createPortal(<dialog ref={dialog} className="settings-dialog contact-settings-dialog" aria-labelledby={title} onClose={e=>{if(e.target===e.currentTarget)setOpened(false);}} onCancel={e=>{if(busy)e.preventDefault();}}>
   <header><h2 id={title}>人物の設定</h2><button type="button" disabled={busy} aria-label="人物設定を閉じる" onClick={()=>dialog.current.close()}><X size={20}/></button></header>
   <form onSubmit={rename}>
    <label>名前の変更<input value={name} placeholder={contact.initialName || contact.displayName} maxLength={100} disabled={busy} onChange={e=>setName(e.target.value)} /></label>
    <p>こねくと内の表示名です。LINE・Slack側の名前は変更しません。空欄で保存すると初期名に戻ります。</p>
    {error&&<p role="alert">{error}</p>}
    <button className="contact-menu-action" disabled={busy||name.trim()===contact.displayName}>名前を保存</button>
   </form>
   <div className="contact-danger-actions">
    <DeleteHistory contactId={contact.id} name={contact.displayName} disabled={disabled||busy} triggerLabel="トーク履歴を削除" onDeleted={async result=>{dialog.current.close();await onChanged(result);}} />
    <DeleteHistory complete contactId={contact.id} name={contact.displayName} disabled={disabled||busy} triggerLabel="人物を完全削除" onDeleted={onDeleted} />
   </div>
  </dialog>,document.body)}
 </>;
}
