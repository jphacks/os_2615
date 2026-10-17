<!-- LINE画像送受信の実機確認手順。 -->
# LINE画像の確認

LINEのみ画像送受信を追加。Slackの画像処理・Scopeは変更していない。

## 起動

1. ルート.envのPUBLIC_BASE_URLへ現在のngrok HTTPS URLを設定する。
   例: PUBLIC_BASE_URL=https://example.ngrok-free.dev
2. BackendをCtrl+Cで停止し、ルートでnpm startを実行する。
3. npm run build --prefix frontendで画面をビルドする。
4. PWAプレビューを停止して、frontendでPWA_PUBLIC_HOST=実際のホスト npm run previewを実行する。
5. ngrokの転送先は5174。プレビューが/apiを3000、/webhooks/lineと/mediaを3001へ転送する。
6. LINE Webhook URLを「現在のHTTPS URL + /webhooks/line」に合わせる。

## 実機で試すこと

- LINEから写真を1枚送る。Inboxの「[画像]」と会話内の画像表示・未返信を確認する。
- 画像をタップして別画面でも開けることを確認する。
- こねくとのLINE会話で「画像を選択」から1MB以下のJPEG/PNGを選ぶ。
- プレビューを確認し「この画像を送信」で送り、LINEへ実際に届くことを確認する。
- 画像送信後の未返信解除・リマインダー完了を確認する。
- Backend再起動後も受信・送信画像が表示されることを確認する。
- Backend停止などで失敗した場合に画像選択が残ることを確認する。結果不明なら先にLINE側で到達を確認する。

送信は1枚・1MBまで。原画像とプレビューを同じURLで渡すため、プレビューの制限に合わせている。
HEIC・GIF・動画は対象外。文章と画像は別送信となり、画像送信で文章の下書きは消さない。
受信は最大10MB。内容の取得失敗時はWebhookがエラーを返すため、再配信設定も必要に応じて確認する。
保存した画像の自動削除・容量管理は未実装。送信失敗時でも画像ファイルが残る場合がある。
バックアップは画像を含むdata/全体を対象にする。

## 検証

署名付き受信、重複排除、画像配信、再起動後の保持、Push送信内容、容量・形式制限、
画像取得/送信エラーをStubで検証済み。実機では受信画像の表示と、こねくとからの画像送信成功をユーザーが確認した。

仕様: https://developers.line.biz/ja/reference/messaging-api/#image-message
