/* ブラウザがインストール可能と判断したときだけ、明示操作で案内する。 */
import React, { useEffect, useState } from 'react';
export default function InstallApp() {
  const [prompt, setPrompt] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const available = event => { event.preventDefault(); setPrompt(event); };
    const installed = () => setPrompt(null);
    window.addEventListener('beforeinstallprompt', available);
    window.addEventListener('appinstalled', installed);
    return () => {
      window.removeEventListener('beforeinstallprompt', available);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);
  if (!prompt) return null;
  return <div className="install-app">
    <span>こねくとをホーム画面に追加</span>
    <button disabled={busy} onClick={async () => {
      if (busy) return;
      setBusy(true);
      try { await prompt.prompt(); await prompt.userChoice; }
      catch { /* ブラウザメニューからも追加できる。 */ }
      finally { setPrompt(null); setBusy(false); }
    }}>インストール</button>
    <button disabled={busy} aria-label="インストール案内を閉じる" onClick={() => setPrompt(null)}>閉じる</button>
  </div>;
}
