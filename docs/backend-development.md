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

初期Inboxは空。LINE・Slackの実メッセージを受信して確認する。
架空データの投入コマンドとFrontendのMockモードは削除済み。テスト用データはtests/fixtures/内でのみ使用する。

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
- POST /api/messages/replyによるLINE Push・Slack DMへのテキスト返信。
- Provider送信成功後の送信履歴保存・未返信解除・設定済みReminder完了。
- 同じ会話への並行送信の拒否、送信中の新着・Reminder再設定の保護。
- PATCH /api/contacts/:id/favoriteによるお気に入り登録・解除、保存と再起動後の保持。

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

## 返信の実機確認

1. サーバーを再起動し、SlackのSLACK_CONNECTEDを確認する。Tokenは受信確認時の4項目をそのまま使う。
2. GET /api/contactsの実際のLINE・Slack Conversation.idをそれぞれ控える。
   Contact.idとは異なる。demo-で始まる架空会話へは実送信しない。
3. 各Conversationへ下記を1回ずつ実行する。会話IDは実際の値へ置き換える。

```sh
curl -i http://127.0.0.1:3000/api/messages/reply \
  -H 'Content-Type: application/json' \
  -d '{"conversationId":"実際の会話ID","text":"こねくとから返信テスト"}'
```

4. 201とdata.message.isFromMe: true、data.conversation.hasUnreplied: falseを確認する。
5. LINE・Slackの実際の画面にも同じ本文が届いていることを確認する。
6. 人物ごとの履歴APIに「自分」の送信履歴が追加され、未返信フィルタから外れることを確認する。
7. 相手から再度送ると未返信に戻ることと、サーバー再起動後も送信履歴が残ることを確認する。

LINEは保存userIdを宛先にPushする。replyTokenは使わず、送信前に/v2/bot/infoで公式アカウントIDを取得する。
Slackは保存済みDM channel IDにchat.postMessageする。送信本文は空白・改行を維持し、上限は5000 UTF-16単位。
両ProviderともAPIの生JSONはMapperで共通Messageへ変換し、models/message.jsで検証して保存する。
新しいScope・環境変数は追加していない。

成功201は外部APIの受理とローカル保存の成功を表す。端末での配信・閲覧は保証しない。
送信中に新着が保存された場合は、成功201でもhasUnrepliedをtrueのまま残す。
同じ会話の二重送信は409 REPLY_IN_PROGRESS。他の会話への送信は待たせない。
送信失敗・Token未設定では、履歴・未返信・Reminderを変更しない。
送信成功時は開始時点のpending Reminderをdoneにするが、途中の日時変更・取消は上書きしない。

タイムアウト、送信APIの5xx、不正な成功レスポンス、送信後の保存失敗はDELIVERY_UNKNOWNとして返す。
Frontendは入力文を残す。自動再送は行わず、送信先を確認してから手動で判断する。
外部APIとJSON保存は1つのトランザクションにできないため、送信済みでも保存されない場合がある。
この場合に履歴を自動復元する機能はMVP対象外。
送信前の公式アカウント情報取得が失敗した場合はPush自体を行わず、PROVIDER_ERRORを返す。
APIのタイムアウトは1リクエスト5秒。LINEの初回は公式アカウント情報取得とPushの2リクエストとなる。

Frontend担当は既存のAPIクライアントのまま利用可能。Frontendは常に実APIへ接続し、切替用の環境変数は不要。
今回Frontendファイルは変更していない。

外部送信の仕様は[LINE公式リファレンス](https://developers.line.biz/en/reference/messaging-api/#send-push-message)と
[Slack chat.postMessage公式リファレンス](https://docs.slack.dev/reference/methods/chat.postMessage/)を参照。

## お気に入りの確認

1. サーバーを再起動する。
2. GET /api/contactsで操作対象のContact.idを控える。Conversation.idとは異なる。
3. 以下の人物IDを置き換えて登録する。

```sh
curl -X PATCH http://127.0.0.1:3000/api/contacts/実際の人物ID/favorite \
  -H 'Content-Type: application/json' \
  -d '{"isFavorite":true}'
curl 'http://127.0.0.1:3000/api/contacts?filter=favorite'
```

4. 成功200とdata.isFavorite: true、お気に入り一覧への表示、通常Inboxの上部表示を確認する。
5. サーバー再起動後も同じ状態であることを確認する。
6. 解除時は同じPATCHへisFavorite: falseを送り、お気に入り一覧から外れることを確認する。

実APIモードのFrontendでは既存の星ボタンで同じ操作ができる。Frontendファイルは変更していない。
指定したbooleanを保存するため、同じ値の再送で状態が反転することはない。
メッセージ・未返信状態・Reminder・lastMessageAtは変更しない。
未知の人物は404、不正な本文やクエリは400、保存失敗は500 STORAGE_ERRORとなり、既存状態を維持する。

## 次の段階

Reminderの取得・設定・取消APIを実装済み。実APIモードのFrontendから確認できる。

1. Backendを再起動し、会話の「後で返信」で未来の時刻を指定する。
2. 「後で返信」一覧と会話に設定した時刻が表示されることを確認する。
3. 設定時刻を過ぎてもpendingのまま対象に残り、画面で期限超過が目立つことを確認する。
4. 再起動後も設定が残ること、取消すると対象から外れることを確認する。
5. 設定後に返信し、成功時にReminderがdoneとなることを確認する。

GET /api/remindersはpendingを返す。status=all/done/cancelledも指定できる。
POSTは会話ごとにpendingを1件だけ保存し、新規201・更新200を返す。
PATCHはcancelledのみ受け付け、doneの取消は409となる。
API契約・Frontendファイルは変更していない。Backend 58件・Frontend 5件の自動テストが成功。
実機での時刻表示・期限超過表示は上記の画面操作で確認する。
自動テストは署名付きHTTPリクエスト、Boltイベント処理経路、外部APIのStubで検証している。
LINEの実機テキスト・スタンプ受信とSlack DM受信は確認済み。実機での返信は上記手順で別途確認する。

data/はGit管理外。1つの保存ファイルを複数プロセスで同時に開かない。
ファイル欠落時だけ空状態で起動し、破損時は起動を失敗させて既存ファイルを保持する。
復旧はバックアップを確保したうえで行う。

## Slack接続タイムアウトへの対応

Socket ModeのSDK自動再接続は無効にし、アプリ側で接続失敗をcatchして5秒後に再試行する。
SDKの接続APIタイムアウトは10秒。接続準備前の認証初期化失敗は従来どおりログを出してHTTPを維持する。
接続後の切断中はSlack返信をエラーにし、再接続成功後に返信クライアントを有効にする。
接続だけを再試行し、送信メッセージは自動再送しない。Backend終了時は再接続タイマーも停止する。
ログは固定イベント名のみとし、生エラー・Tokenを出力しない。
