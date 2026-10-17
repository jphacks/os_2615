/* LINE画像を選択・確認して送信する。テキストとは別メッセージ。 */
import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { api } from '../services/api.js';
export default function ImageReply({ conversationId, sending, setSending, onSent, onError }) {
  const picker = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  useEffect(() => {
    if (!file) { setPreview(''); return; }
    const url=URL.createObjectURL(file);setPreview(url);
    return () => URL.revokeObjectURL(url);
  },[file]);
  return <div className="image-reply">
    <div className="image-picker-toolbar">
      <button type="button" className="image-picker-button" aria-label="画像を選択" title="画像を選択（JPEG・PNG／1MBまで）" disabled={sending} onClick={() => picker.current?.click()}>
        <ImagePlus size={24} aria-hidden="true" />
      </button>
      <span className="image-picker-hint">JPEG・PNG／1MBまで</span>
    </div>
      <input ref={picker} hidden aria-label="送信する画像ファイル" type="file" accept="image/jpeg,image/png" disabled={sending} onChange={e=>{
        const chosen=e.target.files?.[0];e.target.value='';if(!chosen)return;
        if(!['image/jpeg','image/png'].includes(chosen.type)||chosen.size>1024*1024){onError('JPEG・PNGの1MB以下の画像を選んでください。');return;}
        setFile(chosen);
      }} />
    {file && <div>
      {preview && <img src={preview} alt="送信する画像のプレビュー" />}
      <span>{file.name}</span>
      <button type="button" disabled={sending} onClick={()=>setFile(null)}>画像を取り消す</button>
      <button type="button" disabled={sending} onClick={async()=>{
        if(sending)return;setSending(true);onError('');
        try{await api.replyImage(conversationId,file);setFile(null);await onSent();}
        catch(e){onError(e.message);}
        finally{setSending(false);}
      }}>{sending?'送信中…':'この画像を送信'}</button>
    </div>}
  </div>;
}
export function MessageImage({ media }) {
  const [failed,setFailed]=useState(false);
  if(!media || !/^\/api\/media\/[0-9a-f-]{36}\.(png|jpg)$/.test(media.url)||failed)return <span>画像を表示できません。</span>;
  return <a href={media.url} target="_blank" rel="noreferrer"><img className="message-image" src={media.url} alt="送受信した画像" loading="lazy" onError={()=>setFailed(true)} /></a>;
}
