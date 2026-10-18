/* 予約送信はリマインダーと分け、本文・宛先・日時を確定前に確認する。 */
import React, {useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {Clock3, X} from 'lucide-react';
import {startVisiblePolling} from '../services/visiblePolling.js';
import {api} from '../services/api.js';
import ReminderCalendar from './ReminderCalendar.jsx';
import {localDateTime} from './reminderDate.js';
function requestId() {
 if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
 const bytes=crypto.getRandomValues(new Uint8Array(16)); bytes[6]=(bytes[6]&15)|64; bytes[8]=(bytes[8]&63)|128;
 const hex=[...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');
 return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
const labels = {pending:'送信待ち',sending:'送信中（取消不可）',sent:'送信済み',failed:'送信失敗',unknown:'送信結果を確認してください',missed:'期限切れ（未送信）'};
export default function ScheduledMessages({conversationId, name, platform, text, disabled, onReserved, onRefresh}) {
 const [jobs,setJobs]=useState([]), [when,setWhen]=useState(''), [body,setBody]=useState(''), [error,setError]=useState(''), [busy,setBusy]=useState(false), [opened,setOpened]=useState(false), [latest,setLatest]=useState('');
 const dialog=useRef(null), request=useRef(null), version=useRef(0), mounted=useRef(true);
 async function load() {
  const v=++version.current;
  try {const result=await api.scheduledMessages(conversationId);if(mounted.current&&v===version.current)setJobs(current=>JSON.stringify(current)===JSON.stringify(result.data)?current:result.data);}
  catch(e){if(mounted.current&&v===version.current)setError(e.message);}
 }
 useEffect(()=>{
  mounted.current=true;
  const stop = startVisiblePolling(load);
  return()=>{mounted.current=false;++version.current;stop();};
 },[conversationId]);
 function open(){setLatest(localDateTime(new Date(Date.now()+14*24*60*60000)));setBody(text);setWhen(localDateTime(new Date(Date.now()+30*60000)));setError('');request.current=null;setOpened(true);dialog.current.showModal();}
 async function reserve(event){
  event.preventDefault();event.stopPropagation();if(busy)return;
  if(!body.trim()||body.length>5000||!Number.isFinite(Date.parse(when))||Date.parse(when)<=Date.now()){setError('本文を入力し、未来の日時を選んでください。');return;}
  if(Date.parse(when)>Date.now()+14*24*60*60000){setError('予約できる日時は現在から14日後までです。');return;}
  setBusy(true);setError('');
  const payload={conversationId,text:body,sendAt:new Date(when).toISOString()};
  const fingerprint=JSON.stringify(payload);
  if(request.current?.fingerprint!==fingerprint)request.current={fingerprint,id:requestId()};
  try{await api.scheduleMessage({...payload,requestId:request.current.id});dialog.current.close();onReserved(body);await load();}
  catch(e){setError(e.message);await load();}
  finally{setBusy(false);}
 }
 async function cancel(id){if(busy)return;setBusy(true);setError('');try{await api.cancelScheduledMessage(id);await load();await onRefresh();}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <section className="scheduled-messages" aria-label="予約送信">
  <button type="button" className="schedule-trigger" disabled={disabled||busy||!text.trim()} onClick={open}><Clock3 size={15}/>予約送信</button>
  <small>入力した文章を指定時刻に自動送信します</small>
  {error&&!opened&&<p role="alert">{error}</p>}
  <div className="scheduled-list">{jobs.filter(job=>job.status!=='cancelled').map(job=><div className={`scheduled-message schedule-${job.status}`} key={job.id}>
   <strong>{labels[job.status]}</strong><time dateTime={job.sendAt}>{new Date(job.sendAt).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</time>
   <p>{job.text}</p>
   {['unknown','failed','missed'].includes(job.status)&&<small>自動再送しません。送信先を確認し、必要なら新しく予約してください。</small>}
   {job.status==='pending'&&<button type="button" disabled={busy} onClick={()=>cancel(job.id)}>予約を取り消す</button>}
  </div>)}</div>
  {createPortal(<dialog ref={dialog} className="modal scheduled-dialog" aria-labelledby="schedule-title" onCancel={event=>{if(busy)event.preventDefault();}} onClose={()=>{setOpened(false);setError('');}}>
   <button type="button" className="modal-close icon-button" aria-label="予約送信を閉じる" disabled={busy} onClick={()=>dialog.current.close()}><X size={19}/></button>
   <h2 id="schedule-title">予約送信</h2>
   {opened&&<form onSubmit={reserve}>
    <p><strong>{name}</strong>さんへ・{platform==='line'?'LINE':'Slack'}</p>
    <label>送信する本文<textarea aria-label="予約送信の本文" value={body} maxLength={5000} disabled={busy} onChange={event=>setBody(event.target.value)} rows={3}/></label>
    <ReminderCalendar value={when} onChange={setWhen} disabled={busy} maxDateTime={latest}/>
    <p className="modal-note">予約できるのは現在から14日後までです。</p>
    <p className="modal-note">Backendの起動中に送信します。停止中に時刻を過ぎた予約は送信しません。送信開始後は取り消せません。通常の返信や「既読」操作では予約は取り消されません。</p>
    {error&&<p role="alert" className="modal-error">{error}</p>}
    <button className="send-button modal-submit" disabled={busy||!body.trim()}>{busy?'予約中…':'この内容・日時で予約する'}</button>
   </form>}
  </dialog>,document.body)}
 </section>;
}
