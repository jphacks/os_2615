<!--
実機確認済みの起動・デモ・復旧手順をまとめる。
-->
# こねくと デモ手順

## 起動

このMacのプロジェクトは /Users/mahiro/hackathon にある。
以下はそれぞれ別のターミナルで実行する。既に起動しているものを重複起動しない。

Backend:

```sh
cd /Users/mahiro/hackathon
npm start
```

Frontend（Macのみなら --host 0.0.0.0 を省略可能）:

```sh
cd /Users/mahiro/hackathon/frontend
npm run dev -- --host 0.0.0.0
```

LINE受信用トンネル:

```sh
ngrok http http://127.0.0.1:3001
```

Macでは http://127.0.0.1:5173/ を開く。
別端末は同じネットワークからViteのNetwork URLを開く。127.0.0.1は各端末自身なので別端末では使わない。
端末間通信が制限されたWi-Fiではアクセスできない場合がある。

ルート.envにはLINE/Slackの4つの認証情報を設定する。Frontendには認証情報を置かない。
Frontendは常に実APIへ接続する。Mockモードの切替設定は不要。
.envとdata/はGit管理外。別の開発端末には自動共有されない。
依存関係が未導入ならルートとfrontendでそれぞれnpm installを行う。

## ポートと疎通確認

| ポート | 役割 |
| --- | --- |
| 5173 | Frontendと/apiのBackendへの転送 |
| 3000 | 管理API（Mac内のみ） |
| 3001 | LINE Webhook（Mac内、ngrokで外部から転送） |

```sh
curl http://127.0.0.1:3000/api/health
```

期待値は {"data":{"status":"ok"}}。外部APIへの接続確認とは別。
LINE DevelopersのWebhook URLは、現在のngrok HTTPS URLに /webhooks/line を付ける。
ngrok側のPOST /webhooks/lineが200となることを確認する。
SlackはSocket Modeなのでngrok不要。LINEの新着受信はngrokが必要。
LINEへのPush返信とSlackの送受信にはインターネット接続が必要。

## 本番デモの流れ

1. 実サービスの相手をLINEとSlackから1人ずつ決め、画面を「すべて」にする。
2. LINEから「明日の集合時間どうする？」、Slack DMから「資料を確認してください」を送る。
3. 5秒ごとの更新または再取得で、同じInboxに別々のContactとして並ぶことを示す。
4. 「未返信」フィルタで両方を示し、LINEの会話履歴を開く。
5. 「13時でどう？」と返信し、LINE側への到達と未返信解除を示す。
6. Slackにも返信し、Slack側への到達を示す。
7. Slackからもう1件送信し、その会話をお気に入り登録してフィルタに表示する。
8. 「後で返信」で未来の日時を選び、選択中の日時を確認して確定する。
9. 「後で返信」一覧で確認する。時刻到達を見せる場合は1〜2分後に設定し、返信せず待つ。
10. 「返信の時間です」の強調を示し、返信すると対象から外れることを示す。

通常Inboxはお気に入り優先。新着が必ず一番上になるとは限らない。
LINE/Slackは人ごとに独立して扱い、同一人物の自動統合はしない。
リマインダーはアプリ内表示のみで、外部への通知は送らない。

## 確認済み

2026-10-17、実Backend接続でユーザーが以下を確認した。

- LINEテキスト・スタンプ受信、Slack DM受信と共通Inbox表示
- LINE・Slackへの返信到達
- お気に入り登録・解除とフィルタ反映
- 後で返信の表示、時刻到達時の強調、返信後の対象解除
- Backend再起動後のデータ保持
- 2台の端末からアクセス・送信
- Backend停止時のエラーと入力文保持、復旧後の手動再送成功

自動確認: Backend 58件、Frontend 4件のテスト成功、Frontendビルド成功。
最新版の配色と文言変更後は、本番前に画面を再読み込みして見え方を確認する。

## 復旧

- 古いDEMO表示: 最新コードでViteを再起動し、ブラウザを再読み込みする。
- API/JSONエラー: Backend起動とhealthを確認し、復旧後「再取得」を押す。
- 送信結果不明: まずLINE/Slack側で到達を確認する。自動再送や連打を避け、未着を確認して手動再送する。
- LINE新着が来ない: ngrokがonlineか、URLと /webhooks/line が一致するかを確認する。/webhook/lineは誤り。
- Slack新着が来ない: BackendのSocket Mode接続を確認する。同じSlack Appを使う旧検証プロセスを同時起動しない。
- ポート使用中: 既存ターミナルを確認し、同じサーバーを重複起動しない。
- 別端末から開けない: Macの現在のIP、同一ネットワーク、Viteのhost指定を確認する。
- 保存エラー: data/store.jsonを削除・seedで上書きしない。サーバー停止後にデータを退避して原因を調べる。

デモ直前には.envやTokenを画面共有しない。保存済み履歴はデモ準備のために無断削除しない。
