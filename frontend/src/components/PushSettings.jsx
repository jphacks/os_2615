import React, { useEffect, useRef, useState } from 'react';
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
  const receivedTest = useRef(false);
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
  useEffect(() => {
    if (!supported) return;
    const received = event => {
      if (event.data?.type !== 'KONEKUTO_PUSH_TEST') return;
      receivedTest.current = true;
      setStatus(event.data.stage === 'shown' ? 'このブラウザでプッシュ通知を受信し、表示処理が完了しました。' : 'プッシュ通知は受信しましたが、表示処理に失敗しました。通知の許可を確認してください。');
    };
    navigator.serviceWorker.addEventListener('message', received);
    return () => navigator.serviceWorker.removeEventListener('message', received);
  }, [supported]);
  async function enable() {
    if (!ready || busy) return;
    setBusy(true); setStatus('');
    try {
      // Safariのユーザー操作要件のため、通信を挟まずクリックから直接subscribeする。
      if (subscription) {
        await request('unsubscribe', subscription.toJSON());
        await subscription.unsubscribe();
        setSubscription(null);
      }
      const current = await ready.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: ready.key });
      try { await request('subscribe', current.toJSON()); }
      catch (error) { await current.unsubscribe(); throw error; }
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
    receivedTest.current = false;
    setBusy(true); setStatus('');
    try { await request('test', subscription.toJSON()); if (!receivedTest.current) setStatus('配信サービスが通知を受け付けました。このブラウザの受信確認を待っています。届かない場合は「通知を再登録」を押して再度お試しください。'); }
    catch (error) { setStatus(error.message); }
    finally { setBusy(false); }
  }
  async function testLocal() {
    if (!ready || busy) return;
    setBusy(true); setStatus('');
    try {
      await ready.registration.showNotification('こねくと：端末内の表示テスト', {
        body: 'これはネットワークを通さない通知の表示テストです。',
        tag: `konekuto-local-test-${Date.now()}`, icon: '/icons/crayon-192.png', data: { url: '/' }
      });
      setStatus('ブラウザの表示処理は完了しました。見えない場合は、端末の設定→通知で、使用中のブラウザまたはこねくとの通知許可・バナーを確認してください。集中モード・画面共有中の通知制限も確認してください。');
    } catch {
      setStatus('端末内でも通知を表示できませんでした。ブラウザとOSの通知許可を確認してください。');
    } finally { setBusy(false); }
  }
  return <fieldset><legend>端末への通知</legend>
    <p>新着メッセージと「後で返信」の指定時刻を通知します。画面を閉じていても受信できます。通知に人物名・本文は表示しません。</p>
    <p>この受信箱全体の通知が届きます。通知を受け取る端末ごとに有効にしてください。Backendとngrokの稼働が必要です。</p>
    {ios && !standalone ? <p>iPhoneはiOS 16.4以降が必要です。共有メニューから「ホーム画面に追加」し、追加したこねくとを開いて通知を有効にしてください。</p>
      : !supported ? <p>この環境は通知に対応していません。HTTPSのURLを対応ブラウザで開いてください。iPhoneではホーム画面への追加も必要です。</p>
      : <div className="push-settings-actions">
        <button type="button" disabled={!ready || busy} onClick={enable}>{subscription ? '通知を再登録' : '通知を有効にする'}</button>
        {subscription && <><button type="button" disabled={busy} onClick={test}>テスト通知</button><button type="button" disabled={!ready || busy} onClick={testLocal}>端末内の表示テスト</button><button type="button" disabled={busy} onClick={disable}>通知を停止</button></>}
      </div>}
    <p role="status">{status || (subscription ? 'このブラウザには通知の登録があります。' : '')}</p>
  </fieldset>;
}
