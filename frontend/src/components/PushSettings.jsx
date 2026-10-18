import React, { useEffect, useState } from 'react';
async function request(path, subscription) {
  const response = await fetch(`/api/push/${path}`, { signal: AbortSignal.timeout(15000), method: subscription ? 'POST' : 'GET',
    headers: subscription ? { 'Content-Type': 'application/json' } : {},
    body: subscription ? JSON.stringify(subscription) : undefined });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || '通知設定を確認できません。Backendを再起動してください。');
  return result.data;
}
function keyBytes(value) {
  const decoded = atob(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '='));
  return Uint8Array.from(decoded, char => char.charCodeAt(0));
}
export default function PushSettings() {
  const supported = window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const [ready, setReady] = useState(null), [subscription, setSubscription] = useState(null);
  const [busy, setBusy] = useState(false), [status, setStatus] = useState('');
  useEffect(() => {
    if (!supported || ios && !standalone) return;
    let live = true;
    (async () => {
      try {
        const [config, registration] = await Promise.all([
          request('config'), navigator.serviceWorker.register('/push-sw.js', { scope: '/', updateViaCache: 'none' })
        ]);
        await navigator.serviceWorker.ready;
        const current = await registration.pushManager.getSubscription();
        if (live) { setReady({ registration, key: keyBytes(config.publicKey) }); setSubscription(current); }
      } catch { if (live) setStatus('通知設定を読み込めません。Backendを再起動して、ページを再読み込みしてください。'); }
    })();
    return () => { live = false; };
  }, [supported, ios, standalone]);
  async function enable() {
    if (!ready || busy) return;
    setBusy(true); setStatus('');
    try {
      // Safariのユーザー操作要件のため、通信を挟まずクリックから直接subscribeする。
      const current = subscription || await ready.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: ready.key });
      try { await request('subscribe', current.toJSON()); }
      catch (error) { if (!subscription) await current.unsubscribe(); throw error; }
      setSubscription(current); setStatus('この端末の通知を有効にしました。');
    } catch (error) {
      setStatus(Notification.permission === 'denied' ? '通知が拒否されています。ブラウザ・端末の設定で、こねくとの通知を許可してください。' : error.message || '通知を有効にできませんでした。');
    } finally { setBusy(false); }
  }
  async function disable() {
    if (!subscription || busy) return;
    setBusy(true); setStatus('');
    try {
      await request('unsubscribe', subscription.toJSON());
      await subscription.unsubscribe(); setSubscription(null); setStatus('この端末の通知を停止しました。');
    } catch (error) { setStatus(error.message); }
    finally { setBusy(false); }
  }
  async function test() {
    setBusy(true); setStatus('');
    try { await request('test', subscription.toJSON()); setStatus('テスト通知を送信しました。端末の通知設定・集中モードも確認してください。'); }
    catch (error) { setStatus(error.message); }
    finally { setBusy(false); }
  }
  return <fieldset><legend>端末への通知</legend>
    <p>新着メッセージと「後で返信」の指定時刻を通知します。画面を閉じていても受信できます。通知に人物名・本文は表示しません。</p>
    <p>この受信箱全体の通知が届きます。通知を受け取る端末ごとに有効にしてください。Backendとngrokの稼働が必要です。</p>
    {ios && !standalone ? <p>iPhoneはiOS 16.4以降が必要です。共有メニューから「ホーム画面に追加」し、追加したこねくとを開いて通知を有効にしてください。</p>
      : !supported ? <p>この環境は通知に対応していません。HTTPSのURLを対応ブラウザで開いてください。iPhoneではホーム画面への追加も必要です。</p>
      : <div className="push-settings-actions">
        <button type="button" disabled={!ready || busy} onClick={enable}>{subscription ? '通知を再登録' : '通知を有効にする'}</button>
        {subscription && <><button type="button" disabled={busy} onClick={test}>テスト通知</button><button type="button" disabled={busy} onClick={disable}>通知を停止</button></>}
      </div>}
    <p role="status">{status || (subscription ? 'このブラウザには通知の登録があります。' : '')}</p>
  </fieldset>;
}
