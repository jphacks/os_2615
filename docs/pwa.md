<!-- ホーム画面へのインストール確認と配信条件を説明する。 -->
# PWAとして使う

こねくとのWeb画面をホーム画面へ追加し、ブラウザのアドレスバーがない単独ウィンドウで起動できる設定を追加した。
Android用のAPKではなく、ブラウザからインストールするWebアプリ。インストール可否・メニュー表記はブラウザによって異なる。

## 現在の動作範囲

- アプリ名・192/512pxアイコン・Androidの切り抜き用アイコン・単独ウィンドウ起動を設定済み。
- ブラウザがbeforeinstallpromptを発行した場合だけ、画面にインストールボタンを表示する。
- APIとメッセージはキャッシュしない。Service Workerによるオフライン対応は実装していない。
- インストール後もFrontend配信とBackend起動、外部送受信用のインターネット接続が必要。
- Web Pushで新着・返信リマインダーを通知できる。設定で端末ごとの許可が必要。iPhoneはiOS 16.4以降でホーム画面に追加して利用する。

ブラウザの要件は[MDNのインストール条件](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)を参照。
スマホからMacのLAN IPへHTTPで接続した場合は、ホーム画面のショートカットになってもPWAとしてのインストール条件は満たさない。

## Androidでの確認（ngrokのHTTPSを利用）

Backendは通常どおりルートでnpm startを実行しておく。
Frontendは開発用Viteとは別に、ビルド済み画面を5174で配信する。

```sh
cd /Users/mahiro/hackathon
npm run build --prefix frontend
```

1. 既存のngrokを使っている場合はCtrl+Cで停止する。この手順では1本のトンネルを画面とLINE受信で共用する。
2. 別ターミナルで次を実行し、ForwardingのHTTPS URLを控える。プレビュー起動前は502になっていてもよい。

```sh
ngrok http http://127.0.0.1:5174
```

3. URLのホスト部分（https://を除いたもの）を指定してプレビューを起動する。以下のexample.ngrok-free.devは実際のホストに置き換える。

```sh
cd /Users/mahiro/hackathon/frontend
PWA_PUBLIC_HOST=example.ngrok-free.dev npm run preview
```

4. AndroidのChromeでそのHTTPS URLを開く。ngrokの確認ページが出たら通過し、こねくとの画面を表示する。
5. ブラウザメニューの「アプリをインストール」またはホーム画面への追加を選ぶ。アプリ内にインストールボタンが表示されていれば、それも使える。
6. ホーム画面のアイコンから起動し、独立した画面でInboxが開くこと、受信・返信・タブ操作が動くことを確認する。

認証は未実装の共有Inboxであるため、このURLは管理されたデモ用途として扱う。企業向けの一般公開は認証・権限管理を整備してから行う。

### LINE受信も同じURLを使う場合

プレビューは/apiを3000へ、/webhooks/lineを3001へ転送する。
LINE DevelopersのWebhook URLを「現在のHTTPS URL + /webhooks/line」へ設定する。
Backend側のraw body署名検証はそのまま有効。Slack Socket Modeの設定は変わらない。
トンネルURLが変わったら、PWA_PUBLIC_HOSTとLINE Webhook URLの両方を更新する。

## 確認したこと・未確認のこと

- ビルドと自動テストで動作を検証している。端末への実通知受信は設定画面の「テスト通知」で確認する。
- プレビューからHTML・マニフェスト・PNGアイコンの配信を確認。アイコンの192/512pxサイズも検証した。
- 一時的なBackendを使って同一オリジンの/api転送を確認した。
- iPhoneでホーム画面からの単独起動、会話表示、実サービスへの返信をユーザーが確認済み。
- Android実機のインストールと起動は未確認。BlueStacksではブラウザ側の起動・通信に問題があり、確認できていない。

## iPhoneでの確認

Safariで同じHTTPS URLを開き、共有メニューから「ホーム画面に追加」する。
ホーム画面のアイコンから起動し、会話と返信を確認する。

## 更新・終了

コードを更新したらnpm run build --prefix frontendを再実行して画面を再読み込みする。
オフラインキャッシュを作っていないため、古いAPI応答や履歴をキャッシュから返すことはない。
確認終了時はプレビューとngrokをCtrl+Cで停止できる。
HTTPS URLを変更すると別の配信元になるため、ホーム画面のアプリを入れ直す必要がある場合がある。
本運用では固定のHTTPS配信元を用意する。
