<!--
Backendの現時点の起動・検証手順を記録する。
-->
# Backend開発手順

Node.js 22以上を使用。リポジトリ直下で実行する。

```sh
npm ci
npm test
npm start
```

管理APIは http://127.0.0.1:3000 、LINE専用Webhookは http://127.0.0.1:3001 で起動する。
どちらかのポートを確保できなければ両方を停止する。
外部Tokenなしでも起動可能だが、LINE_CHANNEL_SECRET未設定のWebhookは503を返す。
管理APIを外部公開しない。FrontendはViteの/apiプロキシから3000番へ接続する。
SLACK_BOT_TOKENとSLACK_APP_TOKENが両方設定されていれば、同じプロセスでSlack Socket Modeも起動する。
片方でも未設定ならSLACK_NOT_CONFIGUREDをログに出し、LINEと管理APIは通常どおり動作する。

```sh
curl http://127.0.0.1:3000/api/health
curl http://127.0.0.1:3000/api/contacts
```

初期Inboxは空。架空の会話で確認する場合はサーバーを止めてから明示実行する。

```sh
npm run seed:demo
npm start
```

既存データがある場合はseedを拒否する。起動中に別プロセスでseedを実行しない。
架空データの送信先は実際には存在しない。実サービス連携前は専用の検証用保存先でのみ使い、
実データと混ぜない。

```sh
curl 'http://127.0.0.1:3000/api/contacts?filter=unreplied'
curl http://127.0.0.1:3000/api/contacts/demo-contact-line/messages
curl http://127.0.0.1:3000/api/contacts/demo-contact-slack/messages
```

## 実装済み

- health、人物一覧とフィルタ、人物ごとの会話履歴。
- 単一プロセスのJSONストア。更新の直列化と一時ファイルからの置換。
- 保存エラー・破損データの保護と共通エラー応答。
- 再起動後の履歴・お気に入り・Reminder保持のテスト。
- LINE Webhookのraw body署名検証、text・sticker・otherの共通形式への変換。
- Contact・Conversation・Messageをまとめて保存し、新着を未返信にする。
- LINE再配信の重複排除。遅延イベントで会話の最新表示を巻き戻さない。
- LINEプロフィールの表示名取得。取得失敗時も代替名で受信し、既存の名前は保持する。
- Slack Bolt + Socket ModeによるDM受信・共通形式への変換と永続化。
- Slack Bot自身・他のBot・チャンネル投稿・グループDM・subtype付きイベントを除外。
- Slack表示名取得・本文中の絵文字保持・メッセージtsと会話IDによる重複排除。

## LINE実機確認

1. ルートの.envにLINE_CHANNEL_SECRETとLINE_CHANNEL_ACCESS_TOKENを設定する。
   値はソース・チャット・ログに貼らない。.env.exampleは空欄のまま維持する。
2. 架空データを投入済みの場合は、サーバーを停止してdata/store.jsonをバックアップし、
   実機確認用には空の保存先から始める。実データがある場合は削除しない。
3. npm startで起動し、別ターミナルで次を実行する。

```sh
ngrok http http://127.0.0.1:3001
```

4. ngrokのHTTPS URLに/webhooks/lineを付けてLINE DevelopersのWebhook URLに設定する。
   3000番の管理APIをngrokへ転送しない。
5. Consoleの検証が成功することを確認し、Webhook利用を有効にする。
6. こねくとLINEへ1対1でテキストとスタンプを送る。
7. GET /api/contactsでLINEのContactを取得し、そのidで履歴を確認する。
8. サーバー再起動後も同じ会話・履歴が残ることを確認する。

署名不正は401、署名Secret未設定は503、保存失敗は500を返す。
プロフィール取得だけ失敗した場合は受信自体を成功させ、固定名のログイベントを出す。
表示名取得のタイムアウトは1.5秒。成功した名前はプロセス内でキャッシュする。
受信時の自動返信は行わず、replyTokenは保存しない。
再配信で途中まで保存済みのバッチが届いても、処理済みメッセージを飛ばして残りを処理する。

署名検証・プロフィール取得の仕様は[LINE Messaging API公式リファレンス](https://developers.line.biz/en/reference/messaging-api/)に従う。

## Slack実機確認

1. 事前検証用のkonekuto-slackが起動中なら停止する。同じAppの複数Socket Mode接続へ
   イベントが分配されると、こねくと側で受信できない場合がある。
2. ルートの.envに取得済みのSLACK_BOT_TOKENとSLACK_APP_TOKENを設定する。
   LINEの2項目は保持する。値をチャット・ログ・Gitへ出さない。
3. サーバーを停止し、npm startで再起動する。SLACK_CONNECTEDが出れば初回接続成功。
4. Slackの「Konekuto Slack」Appへ「Slack受信テスト123 :smile:」をDMで送る。
5. 下記でデモデータとは別のSlack Contactと本文、hasUnreplied: trueを確認する。

```sh
curl http://127.0.0.1:3000/api/contacts
```

6. 返されたContact.idでGET /api/contacts/:id/messagesを呼び、履歴を確認する。
7. サーバー再起動後もLINEとSlackの実データが残ることを確認する。

Slackにはngrok・Request URLは不要。既存のSocket Modeとmessage.im設定を利用する。
追加Scopeは不要。users:readで表示名を取得し、取得できない場合は代替名で保存する。
platformUserIdはteamId:userId、platformConversationIdはDMのchannel ID、
platformMessageIdはSlackのts文字列をそのまま保持する。
編集・削除・file_share等のsubtypeは今回処理しない。ファイルやリアクションは取得しない。
受信時の自動返信も行わない。

### ログと失敗時

| イベント | 意味・対処 |
| --- | --- |
| SLACK_NOT_CONFIGURED | 2つのTokenのうち少なくとも1つが未設定。設定して再起動 |
| SLACK_CONNECTED | Socket Modeの初回接続成功 |
| SLACK_START_FAILED | 認証・接続に失敗。Token、Socket Mode設定、ネットワークを確認して再起動 |
| SLACK_PROFILE_UNAVAILABLE | 表示名取得失敗。受信は代替名で継続 |
| SLACK_RECEIVE_FAILED | イベント処理・保存失敗。保存先や空き容量を確認し、テストDMを再送 |
| SLACK_WARNING / SLACK_ERROR | SDKの警告・エラー。SDKの生データは出力しない |

Slack接続失敗で管理API・LINEを停止しない。接続確立後の再接続はSDKに任せる。
Web APIリクエストは5秒でタイムアウトし、自動API再試行は行わない。
停止時はSocket Modeを停止し、処理中の受信保存を待つ。
Boltはイベントを自動ACKするため、保存失敗後の再配信は保証しない。
オフライン中や失敗したDMの履歴再取得はMVP対象外。

接続方式は[Slack Bolt公式Socket Modeガイド](https://docs.slack.dev/tools/bolt-js/concepts/socket-mode/)を参照。

## 次の段階

外部返信、お気に入りとReminderの更新APIは未実装。
未実装のHTTP APIは404を返す。
自動テストは署名付きHTTPリクエスト、Boltイベント処理経路、外部APIのStubで検証している。
LINEの実機テキスト・スタンプ受信は確認済み。Slackの実機確認は上記手順で別途行う。

data/はGit管理外。1つの保存ファイルを複数プロセスで同時に開かない。
ファイル欠落時だけ空状態で起動し、破損時は起動を失敗させて既存ファイルを保持する。
復旧はバックアップを確保したうえで行う。
