<!--
構成と担当境界を記録するドキュメント。
-->
# アーキテクチャ

現在はディレクトリ構成のみ。機能は未実装です。

- 担当A（Backend）: src/ とルートのpackage.json・package-lock.json
- 担当B（Frontend）: frontend/
- 共同確定: 共通データ構造とAPI仕様。変更前に双方で合意する。
- LINE・Slack固有処理はproviders/に隔離する。
- 各サービスのユーザーは独立したContactとし、同一人物判定は行わない。
- 保存方式への依存はrepositories/に隔離する。
- models/の共通データ構造は実装前に確定する。
- package-lock.jsonは依存関係のインストール時に生成する。
