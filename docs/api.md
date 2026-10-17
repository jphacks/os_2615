<!--
FrontendとBackendが共有するMVP API契約とMock例を定義する。
-->
# こねくと MVP API契約 v1

現在は契約のみ。各APIは未実装。
共通モデルと状態更新ルールはarchitecture.mdを参照。
同名フィールドの意味・型は全エンドポイントで共通。

## 基本規約

- ベースパス: /api
- JSONリクエストはContent-Type: application/json。
- 成功: { "data": ... }、失敗: { "error": { "code": "...", "message": "..." } }。
- 一覧はdataが配列。0件は空配列。任意の関連要素はnullを返し、省略しない。
- 入力不足・不正値は400、不在IDは404。未知のfilter/statusも400。
- リクエストに余分なフィールドがあれば400。入力からplatformや送信先を信用せず保存済み会話から解決する。
- MVPはページネーションなし。履歴は古い順。内部IDの文字列を画面からそのまま渡す。
- 全時刻はUTC ISO 8601へ正規化。日時入力はタイムゾーン付きの有効な日時を必須とする。
- 生のProviderエラー、Token、Secretをレスポンスに含めない。
- Backend未完成でもFrontend Mockは本書と同じ形を返す。

## InboxItem

GET /contactsのdataはInboxItemの配列。
InboxItem = { contact: Contact, conversation: Conversation, lastMessage: Message | null, reminder: Reminder | null }。
reminderはその会話のpendingのみ。done/cancelledしかない場合はnull。

### Mock・成功例

以下は同じInboxにLINEとSlackを表示する最小例。

```json
{
  "data": [
    {
      "contact": {
        "id": "contact-line-a",
        "platform": "line",
        "platformUserId": "line-user-a",
        "displayName": "山田",
        "isFavorite": false,
        "lastMessageAt": "2026-10-17T01:32:00.000Z"
      },
      "conversation": {
        "id": "conversation-line-a",
        "platform": "line",
        "platformConversationId": "line-user-a",
        "contactId": "contact-line-a",
        "lastMessageId": "message-line-1",
        "hasUnreplied": true,
        "updatedAt": "2026-10-17T01:32:00.000Z"
      },
      "lastMessage": {
        "id": "message-line-1",
        "platform": "line",
        "messageType": "text",
        "platformMessageId": "line-message-1",
        "senderId": "line-user-a",
        "senderName": "山田",
        "conversationId": "conversation-line-a",
        "text": "明日の集合時間どうする？",
        "timestamp": "2026-10-17T01:32:00.000Z",
        "isFromMe": false,
        "metadata": {}
      },
      "reminder": null
    },
    {
      "contact": {
        "id": "contact-slack-b",
        "platform": "slack",
        "platformUserId": "T_DEMO:U_B",
        "displayName": "佐藤",
        "isFavorite": true,
        "lastMessageAt": "2026-10-17T00:45:00.000Z"
      },
      "conversation": {
        "id": "conversation-slack-b",
        "platform": "slack",
        "platformConversationId": "D_DEMO",
        "contactId": "contact-slack-b",
        "lastMessageId": "message-slack-1",
        "hasUnreplied": true,
        "updatedAt": "2026-10-17T00:45:00.000Z"
      },
      "lastMessage": {
        "id": "message-slack-1",
        "platform": "slack",
        "messageType": "text",
        "platformMessageId": "1792197900.000001",
        "senderId": "U_B",
        "senderName": "佐藤",
        "conversationId": "conversation-slack-b",
        "text": "資料を確認してください :smile:",
        "timestamp": "2026-10-17T00:45:00.000Z",
        "isFromMe": false,
        "metadata": {}
      },
      "reminder": {
        "id": "reminder-1",
        "messageId": "message-slack-1",
        "conversationId": "conversation-slack-b",
        "remindAt": "2026-10-17T06:00:00.000Z",
        "status": "pending"
      }
    }
  ]
}
```

上記は構造例。実際の一覧はお気に入り優先なので佐藤が先頭になる。

## GET /api/contacts?filter=all

filter: all（省略時）/ unreplied / favorite / later。
unrepliedはconversation.hasUnreplied、favoriteはcontact.isFavorite、
laterはpending Reminderの存在で絞る。期限超過もlaterに含める。
並び順はお気に入り優先、その中でcontact.lastMessageAt降順、同時刻はcontact.id昇順。
成功200: { data: InboxItem[] }。

## GET /api/contacts/:id/messages

成功200:
{ data: { contact: Contact, conversation: Conversation, messages: Message[], reminder: Reminder | null } }。
messagesはtimestamp昇順。同時刻は保存順を維持する。
reminderはpendingのみ。不在Contactは404。

LINEスタンプのMessage例:

```json
{
  "id": "message-line-sticker",
  "platform": "line",
  "messageType": "sticker",
  "platformMessageId": "line-sticker-1",
  "senderId": "line-user-a",
  "senderName": "山田",
  "conversationId": "conversation-line-a",
  "text": "[スタンプが送信されました]",
  "timestamp": "2026-10-17T01:33:00.000Z",
  "isFromMe": false,
  "metadata": {
    "packageId": "demo-package",
    "stickerId": "demo-sticker",
    "stickerResourceType": "STATIC",
    "keywords": ["happy", "smile"]
  }
}
```

keywordsが欠落・空配列でもUIはtextだけ表示できること。

## POST /api/messages/reply

入力:

```json
{
  "conversationId": "conversation-line-a",
  "text": "13時でどう？"
}
```

textは文字列、空白のみを禁止。長さはUTF-16コード単位で1〜5000。
送信本文の空白・改行は保持する。上限は両サービスで共通。
成功201:
{ data: { message: Message, conversation: Conversation } }。
MessageはisFromMe: true、messageType: text。
Provider送信と保存が成功してから返す。Frontendは成功後にInboxと履歴を再取得する。
同じ会話の送信処理中は409 REPLY_IN_PROGRESS。
自動リトライしない。失敗・結果不明でも入力文を残す。

## PATCH /api/contacts/:id/favorite

入力: { "isFavorite": true }（boolean必須）。
トグル指示ではなく希望値を送る。同じ値の再送も成功。
成功200: { data: Contact }。更新後にInboxを再取得する。

## GET /api/reminders?status=pending

status: pending（省略時）/ done / cancelled / all。
成功200: { data: Reminder[] }。
remindAt昇順、同時刻はid昇順。Contact情報はInboxItemとconversationIdで対応付ける。

## POST /api/reminders

入力:

```json
{
  "conversationId": "conversation-slack-b",
  "messageId": "message-slack-1",
  "remindAt": "2026-10-17T15:00:00+09:00"
}
```

remindAtは受付時点より未来。messageIdは指定Conversationに属する保存済みMessage。
存在しないIDは404、別会話のMessage指定は400。
新規作成201、同じ会話のpending更新200。どちらも { data: Reminder }。
statusはBackendがpendingに設定し、日時をUTCへ正規化する。
UIは新着更新でlastMessageIdが変わり得るため、ユーザーが選んだmessageIdを送る。

## PATCH /api/reminders/:id

入力: { "status": "cancelled" }。
pending→cancelledのみ許可。同じcancelledへの再送は200、doneの取消は409。
doneは返信成功時にBackendが設定する。
成功200: { data: Reminder }。

## GET /api/health

成功200: { "data": { "status": "ok" } }。
プロセス稼働確認のみ。外部サービス接続成功は保証しない。

## POST /webhooks/line（外部受信用）

/api配下ではない。x-line-signatureをraw bodyからHMAC-SHA256で検証してからJSON解析。
署名不正は401、検証設定不足は503、不正JSONは400。
正常処理または処理済み重複イベントは200 { "ok": true }。
保存失敗は500。再配信でも重複保存しない。
ユーザー以外の送信元と対象外イベントは保存せず200。
Slack受信はSocket ModeのためHTTP受信ルートを設けない。

## エラー

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "メッセージ本文を入力してください。"
  }
}
```

| HTTP | code | 意味 |
| --- | --- | --- |
| 400 | VALIDATION_ERROR | 入力・クエリが不正 |
| 404 | NOT_FOUND | リソースまたはルートが存在しない |
| 409 | REPLY_IN_PROGRESS | 同じ会話で送信処理中 |
| 409 | INVALID_STATE | Reminderの状態変更不可 |
| 413 | PAYLOAD_TOO_LARGE | JSON本文が上限超過 |
| 502 | PROVIDER_ERROR | Providerが送信失敗を返した |
| 502 | DELIVERY_UNKNOWN | タイムアウト等で送信結果が不明。送信先を確認 |
| 503 | PROVIDER_NOT_CONFIGURED | 必要なToken・Secretが未設定 |
| 500 | STORAGE_ERROR | 保存処理の失敗 |
| 500 | DELIVERY_UNKNOWN | 送信成功後の保存に失敗。送信先を確認 |
| 500 | INTERNAL_ERROR | その他の内部エラー |

管理APIのJSONサイズ上限は64KB。LINE受信用は別に1MBを設定する。
レスポンスのmessageは表示用。画面の分岐はcodeを使う。
上記2種類のDELIVERY_UNKNOWNは自動再送禁止。送信結果確認後にユーザーが判断する。

## 最初の結合確認

1. MockでLINEとSlackのInboxItemを同時表示できる。
2. 人物を選択し、対応する会話履歴を古い順で表示できる。
3. 返信成功時だけ入力をクリアし、Inbox・履歴を再取得する。
4. 送信失敗時に入力と未返信が残る。
5. スタンプのkeywordsなし、空一覧、404、期限超過Reminderを表示できる。
6. 再起動後も履歴・お気に入り・Reminderが残る。
