/* ネイティブdialogでフォーカスを保持し、文字サイズ・テーマを即時反映する。 */
import PushSettings from './PushSettings.jsx';
import React, { useEffect, useRef, useState } from 'react';
import { Settings as SettingsIcon, X } from 'lucide-react';
import { api } from '../services/api.js';
import { SETTINGS_KEY, applySettings, defaultSettings, readSettings, writeSettings } from '../services/settings.js';
export default function Settings({ onTabMoveMethodChange, openRequest, hideTrigger = false }) {
  const dialog = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const [policy,setPolicy]=useState(null);
  useEffect(() => { if (!openRequest) return; let live=true; api.dataPolicy().then(r=>{if(live)setPolicy(r.data);}).catch(()=>{if(live)setPolicy(null);}); return()=>{live=false;}; }, [openRequest]);
  const [settings, setSettings] = useState(() => {
    try { return readSettings(window.localStorage); } catch { return { ...defaultSettings }; }
  });
  useEffect(() => { if (openRequest) { setIsOpen(true); dialog.current?.showModal(); } }, [openRequest]);
  const [saved, setSaved] = useState(true);
  useEffect(() => {
    applySettings(settings);
    onTabMoveMethodChange?.(settings.tabMoveMethod);
    try { setSaved(writeSettings(window.localStorage, settings)); } catch { setSaved(false); }
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const changed = () => applySettings(settings);
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, [settings, onTabMoveMethodChange]);
  useEffect(() => {
    const changed = event => {
      if (event.key === SETTINGS_KEY) {
        try { setSettings(readSettings(window.localStorage)); } catch { /* 現在の表示は維持する。 */ }
      }
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);
  return <>
    {!hideTrigger && <button type="button" className="settings-trigger" aria-label="表示設定を開く" onClick={() => { setIsOpen(true); dialog.current?.showModal(); }}><SettingsIcon size={19} /></button>}
    <dialog onClose={() => setIsOpen(false)} ref={dialog} className="settings-dialog" aria-labelledby="settings-title">
      <header><h2 id="settings-title">表示設定</h2><button type="button" aria-label="設定を閉じる" onClick={() => dialog.current.close()}><X size={22} /></button></header>
      <p>この端末のブラウザに保存します。他の利用者の画面には影響しません。</p>
      <fieldset><legend>文字の大きさ</legend><div className="settings-options">
        {[['small','小'],['normal','標準'],['large','大'],['extra-large','特大']].map(([value,label]) => <label key={value}><input type="radio" name="fontSize" value={value} checked={settings.fontSize===value} onChange={() => setSettings(current => ({...current,fontSize:value}))} />{label}</label>)}
      </div></fieldset>
      <fieldset><legend>テーマ</legend><div className="settings-options">
        {[['system','端末設定に合わせる'],['light','ライト'],['dark','ダーク']].map(([value,label]) => <label key={value}><input type="radio" name="theme" value={value} checked={settings.theme===value} onChange={() => setSettings(current => ({...current,theme:value}))} />{label}</label>)}
      </div></fieldset>
      <fieldset><legend>タブの移動方法</legend><div className="settings-options settings-move-options">
        {[['both','両方で移動する（標準）'],['drag','ドラッグ＆ドロップで移動する'],['buttons','ボタン操作で移動する']].map(([value,label]) => <label key={value}><input type="radio" name="tabMoveMethod" value={value} checked={settings.tabMoveMethod===value} onChange={() => setSettings(current => ({...current,tabMoveMethod:value}))} />{label}</label>)}
      </div><p>ボタン操作では「一番前へ・前へ・後へ・一番後ろへ」を使います。</p></fieldset>
      <fieldset><legend>データの保存期間（全端末共通）</legend><p>{policy ? `送受信したメッセージ・画像は${policy.retentionDays}日間保存します。` : '保存期間を確認するにはBackendへ接続してください。'} Backend起動時と1時間ごとに期限切れの履歴を削除します。人物・タブ・送信待ち予約は残ります。削除後は元に戻せません。</p></fieldset>
      {isOpen && <PushSettings />}
      <div className="settings-sample"><strong>表示プレビュー</strong><p>誰から届いて、誰に返すかを こねくと ひとつで。</p><span>変更は画面全体へすぐに反映されます。</span></div>
      {!saved && <p role="alert">ブラウザに設定を保存できませんでした。この画面では反映されますが、次回は元に戻る場合があります。</p>}
      <footer><button type="button" onClick={() => setSettings({...defaultSettings})}>標準に戻す</button><button type="button" onClick={() => dialog.current.close()}>完了</button></footer>
    </dialog>
  </>;
}
