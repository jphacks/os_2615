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

http://127.0.0.1:3000 で起動する。現段階では外部Tokenなしで起動可能。
管理APIを外部公開しない。FrontendはViteの/apiプロキシから接続する。

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

## 次の段階

LINE署名検証・受信保存、Slack Socket Mode、外部返信、
お気に入りとReminderの更新APIは未実装。これらのAPIは現段階では404を返す。
現時点のテストには実サービス送受信は含まれない。

data/はGit管理外。1つの保存ファイルを複数プロセスで同時に開かない。
ファイル欠落時だけ空状態で起動し、破損時は起動を失敗させて既存ファイルを保持する。
復旧はバックアップを確保したうえで行う。
