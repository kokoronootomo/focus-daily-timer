# Focus — ポータブル版

ChatGPT Sitesの契約や公開URLに依存せず、一般的な静的Webホスティングで動く版です。

公開URL: https://kokoronootomo.github.io/focus-daily-timer/

GitHub Pagesは `main` ブランチのルートから自動公開されます。

## 主な機能

- タスク追加・選択・削除
- 25／50／90分の集中タイマーと任意の分数設定
- 一時停止・再開
- 端末のスリープや画面切替後も時刻差から残り時間を補正
- 短い休憩・長い休憩・長い休憩の間隔を設定できるポモドーロサイクル
- 集中／休憩の自動開始、休憩スキップ
- 完了音、音量、5分前通知、対応端末でのバイブレーション
- チクタク・雨・渓流・風などの無料環境音
- 日別カレンダーと集中実績
- Obsidianの `brain/Focus/YYYY-MM-DD` への1タップ記録
- JSON形式のバックアップ／復元
- iPhoneのホーム画面追加とオフライン起動

## データについて

データは各ブラウザの端末内ストレージに保存されます。旧URLと新URLは別の保存領域になるため、移行時は旧アプリの「データを書き出す」からJSONを保存し、新アプリの「データを読み込む」で復元してください。

## 公開

このフォルダの中身を、Cloudflare Pages、GitHub Pages、Netlifyなどの静的ホスティングへそのまま配置できます。ビルド処理は不要です。

GitHub Pages用の自動公開設定を `.github/workflows/pages.yml` に同梱しています。リポジトリのPages設定で「GitHub Actions」を選ぶと、`main` ブランチへ変更を保存するたびに新しい版が自動公開されます。

## 修正

- 画面構成：`index.html`
- デザイン：`styles.css`
- 機能：`app.js`
- ホーム画面設定：`manifest.webmanifest`
- オフラインキャッシュ：`sw.js`

更新後は `sw.js` の `CACHE` 名を変更すると、ホーム画面版にも新しいファイルが確実に配信されます。

## 将来の修正方針

1. GitHubリポジトリを正本として残す。
2. 修正前にブランチを作成する。
3. `index.html`、`styles.css`、`app.js`の必要箇所だけを変更する。
4. JavaScriptとJSONの検査を通す。
5. `sw.js` のキャッシュ名を1つ進める。
6. `main`へ反映し、GitHub Pagesの自動公開結果を確認する。
7. 問題があればGitHubの履歴から直前の版へ戻す。
