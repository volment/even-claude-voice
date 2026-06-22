# Claude Voice (Even G2 glasses app)

Even G2 グラスから音声で Claude Code を操作するフロントエンド。
スマホの Even Realities アプリ（WebView）で動き、LAN 上の
[`../bridge`](../bridge) に WebSocket でつなぐ。

## 操作

| 操作 | 動作 |
|---|---|
| テンプルを1回プレス | 録音開始 → もう一度で送信 |
| ダブルプレス | 実行中ならキャンセル / アイドルなら終了（確認ダイアログ） |
| 上スワイプ | 出力を前ページへ |
| 下スワイプ | 出力を次ページへ |

ヘッダ行に状態を表示（`▶ tap to talk` / `● REC` / `… thinking` / `… streaming` など）、
右上の `▲ ▼` は前後にスクロール可能かを示す。

## 設定（IP / ポート / トークン）

グラスにキーボードが無いため、接続先は次の優先順で解決する：

1. **URL クエリパラメータ**（dev の QR URL に付ける）
   ```
   ?bridge=ws://192.168.0.10:8765&token=YOURTOKEN
   ```
   一度渡せば host 側 localStorage に保存され、次回以降は不要。
2. 保存済み localStorage
3. `src/config.ts` の `DEFAULTS`（自分のマシン用に直接編集してもよい）

> `bridge` の値は**ブリッジ起動時にログ表示される** `ws://<LAN-IP>:<port>`、
> `token` は同じくログ表示／config のトークン。

## マニフェスト（app.json）

`app.json` は環境依存（`permissions.whitelist` に各自のブリッジ origin を書く）なので
**gitignore 済み**。テンプレからコピーして自分の IP を入れる：

```bash
cp app.example.json app.json
# app.json の whitelist を ws://<自分のブリッジIP>:8765 に
```

開発時のクエリ接続（`?bridge=...`）にはIPは不要だが、実機の通信許可ゲートに必要。

## 開発（シミュレータ）

ブリッジが先に起動している前提（[`../bridge/README.md`](../bridge/README.md)）。

```bash
cd glasses
npm install

# ターミナル1: dev サーバ
npm run dev                       # http://localhost:5173

# ターミナル2: シミュレータ（GUI。クエリパラメータで接続先を渡す）
npm install -g @evenrealities/evenhub-simulator
evenhub-simulator "http://localhost:5173/?bridge=ws://127.0.0.1:8765&token=YOURTOKEN"
```

シミュレータ上で 576×288 のキャンバスが出る。クリック＝プレス、ダブルクリック＝
ダブルプレス、スクロール＝スワイプに対応。

> シミュレータはマイクをエミュレートしないため、音声フローの実地確認は実機が必要。
> 文字コマンド経路だけ試したい場合は `../bridge` の WebSocket に直接 `command` を投げて検証できる。

## 実機（QR サイドロード）

スマホアプリで Developer Mode を有効化し、同一 LAN で：

```bash
# LAN IP を調べる（macOS Wi-Fi）
ipconfig getifaddr en0

# dev サーバ URL を QR 化（接続先パラメータも込みで）
npm install -g @evenrealities/evenhub-cli
evenhub qr --url "http://<LAN-IP>:5173/?bridge=ws://<LAN-IP>:8765&token=YOURTOKEN"
```

スマホアプリの **Scan QR** で読み取ると、グラスに描画される。

> 実機では `app.json` の `permissions[].whitelist` に**ブリッジの origin**
> （例 `ws://192.168.0.10:8765`）を入れておくこと。ワイルドカード不可・完全一致。
> IP が変わったら更新する。

## パッケージ化（配布）

```bash
npm run build
evenhub pack app.json dist -o claude-voice.ehpk
```

## ファイル構成

| ファイル | 役割 |
|---|---|
| `src/main.ts` | 状態機械。入力イベント → 録音/送信/スクロール、サーバ応答 → 表示 |
| `src/glasses-ui.ts` | グラス描画（単一テキストコンテナ、ヘッダ＋本文＋ページング） |
| `src/conn.ts` | ブリッジへの WebSocket（再接続・keepalive・hello 認証） |
| `src/recorder.ts` | マイク PCM の蓄積と base64 化 |
| `src/config.ts` | 接続先の解決（クエリ → localStorage → 既定） |
| `src/protocol.ts` | ブリッジと共有するメッセージ型 |
| `app.json` | Even Hub マニフェスト |
