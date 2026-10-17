<!--
共通データ構造、状態更新ルール、担当境界を定義する。
-->
# こねくと MVP アーキテクチャ

## 現在の状態と範囲

本書と api.md は並行開発の初期契約。アプリ機能は未実装。
LINEの1対1メッセージとSlack BotへのDMのみを扱う。
同一人物のサービス横断統合、AI、他Provider、グループ・チャンネル投稿は対象外。

## 担当境界

| 担当 | 編集範囲 |
| --- | --- |
| A Backend | src/、tests/、ルートpackage.json・package-lock.json |
| B Frontend | frontend/（依存関係・Mockを含む） |
| 共有 | docs/、.gitignore、.env.example |

共有契約を取り込んでから feature/backend と feature/frontend に分かれる。
共有仕様の変更は先に影響を説明し、双方で合意してmainへ反映する。
README.md、LICENSEは今回の更新対象外。

## 処理経路

受信: Provider → Mapper → MessageService → Repository。
返信: API → ReplyService → 対応Provider → 成功結果をRepositoryに保存。
Frontendと共通ServiceはProviderの生JSONに依存しない。
Providerは共通Message、Contact情報、会話識別情報を受信処理へ渡す。

## 共通規約

- 内部IDはBackendが生成する不透明な文字列。Frontendは分解しない。
- platformは line / slack。messageTypeは text / sticker / other。
- 時刻はUTCのISO 8601文字列（例: 2026-10-17T06:00:00.000Z）。
- Frontendは入力したローカル日時をUTCへ変換して送信し、表示時にローカル時刻へ変換する。
- 未取得の名前はProviderで代替表示名にする。必須文字列をundefinedにしない。
- metadataは常にオブジェクト。秘密情報とreplyTokenを共通Messageに含めない。
- Contact、Conversation、Message、Reminderの関係をBackendで検証する。

## Message

| フィールド | 型・意味 |
| --- | --- |
| id | string、内部ID |
| platform | line / slack |
| messageType | text / sticker / other |
| platformMessageId | string、Provider上のメッセージID |
| senderId | string、Provider上の送信者ID。自分の送信はProviderが解決したBot/公式アカウントID |
| senderName | string、表示名。自分の送信は「自分」 |
| conversationId | string、Conversation.id |
| text | string、表示本文 |
| timestamp | string、メッセージ発生時刻 |
| isFromMe | boolean |
| metadata | object、Provider固有の補足情報 |

スタンプのtextは「[スタンプが送信されました]」。
LINEスタンプのmetadataは取得できたpackageId、stickerId、stickerResourceType、
keywordsを保存する。keywords欠落時は空配列として扱えるようにする。
UIはkeywordsが配列か確認して表示し、画像取得は行わない。
未対応typeはotherと「[未対応のメッセージ]」に変換する。
Slack本文中の絵文字表記はそのまま保持する。本文はHTMLとして描画しない。

## Contact

| フィールド | 型・意味 |
| --- | --- |
| id | string |
| platform | line / slack |
| platformUserId | string |
| displayName | string |
| isFavorite | boolean、初期値false |
| lastMessageAt | string、最後の送受信時刻 |

一意性はplatform + platformUserId。名前の一致で統合しない。
SlackのplatformUserIdはワークスペース識別子とユーザーIDを組み合わせ、
異なるワークスペースでも衝突しない識別子とする。送信用の生IDはProvider内で扱う。
MVPは単一LINE公式アカウントと単一Slackワークスペースで動かす。

## Conversation

| フィールド | 型・意味 |
| --- | --- |
| id | string |
| platform | line / slack |
| platformConversationId | string、LINEはuserId、SlackはDM channel ID |
| contactId | string |
| lastMessageId | string |
| hasUnreplied | boolean |
| updatedAt | string、最後のメッセージ更新時刻 |

MVPではContactにつきConversationは1件。Contactは最初の受信時に会話と一緒に作成する。

## Reminder

| フィールド | 型・意味 |
| --- | --- |
| id | string |
| messageId | string、設定対象の保存済みMessage.id |
| conversationId | string |
| remindAt | string、UTC時刻 |
| status | pending / done / cancelled |

Conversationごとのpendingは最大1件。再設定は同じpendingレコードを更新する。
期限超過もpendingのまま。Frontendが現在時刻と比較して強調する。
返信成功でpendingをdone、明示取消でcancelledにする。外部通知は実装しない。

## 状態更新と失敗時

- 新着受信は未返信にする。既読管理は行わない。
- 過去イベントの遅延再配信で新しい送信より古い受信を追加しても、
  最後の送受信順序を基準に未返信を再計算し、過去メッセージを新着扱いしない。
- ProviderイベントID・メッセージIDで受信を重複排除する。
- 外部送信成功後に送信Messageを保存し、会話・Contact・Reminderをまとめて更新する。
- 送信中の新着受信は未返信のまま残す。送信開始時点の会話状態と照合する。
  同様に送信中に再設定されたReminderは完了にしない。
- 外部API失敗では送信Messageを追加せず、未返信を解除しない。
- ネットワークタイムアウトや外部送信成功後の保存失敗は送信結果不明になり得る。
  自動再送しない。UIに送信先の確認を促す。
- 同一Conversationの並行送信は409で拒否する。UIも送信中はボタンを無効化する。

## 永続化

単一BackendプロセスとローカルJSONを採用する。
Repositoryの内側に共有ストアを置き、全更新を直列化する。
Message・Contact・Conversation・Reminderを1つのdata/store.jsonに保存し、
一時ファイル作成後の置換でまとめて反映する。保存成功後にメモリへ反映する。
破損ファイルを空データで上書きしない。保存エラーは安全な共通エラーにする。
data/をGit管理外にし、Conversation保存と共有ストア用ファイルは実装段階で追加する。

## Providerと接続

LINEはraw bodyでHMAC-SHA256署名検証後にJSON解析する。
通常返信は保存userIdへのPush Message。replyTokenの寿命に依存しない。
SlackはBolt + Socket Mode。DM以外・subtype付き・bot_id付き・自身のuser IDを除外する。
LINE・Slackとも受信処理の失敗をcatchし、秘密情報や生の外部エラーをログに出さない。
認証情報はBackendの.envのみ。Frontendには送らない。

開発時はViteから/apiへプロキシする。画面は5秒程度のポーリングと操作後再取得で更新する。
MVPはローカルの単一利用者を対象とし、管理APIをngrokで公開しない。
LINE用公開経路は/webhooks/lineだけに制限する。
