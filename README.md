# Even G2 × Claude Code — Voice Control

Even Realities G2 グラスから **音声で Claude Code を操作**するプロジェクト。
グラスで話す → ローカル Whisper で文字起こし → Claude Code をセッション継続で実行 →
結果をグラスに表示する。

```
[G2] --BT--> [スマホ Even App / WebView: glasses/] --WS(LAN)--> [Mac/Linux: bridge/]
 発話/操作        録音・表示・スクロール                          ├ Whisper (ローカルSTT)
                                                                  └ claude -p (サブスク認証 / resume)
```

## 構成

| ディレクトリ | 役割 |
|---|---|
| [`bridge/`](bridge) | Mac/Linux で動かす WebSocket サーバー。STT＋Claude Code 駆動。 |
| [`glasses/`](glasses) | Even Hub グラスアプリ（Vite + TS + SDK）。 |

それぞれの詳細は各 README を参照。

## 課金（重要）

- ブリッジは `claude` をヘッドレス実行する際 `ANTHROPIC_API_KEY` を**子プロセスから除去**し、
  ログイン済みの **Claude サブスクリプション（Agent SDK 月次クレジット）** で動かす。API 従量課金にならない。
- 事前に Agent SDK クレジットの**オプトイン**を一度だけ済ませること。
- STT はローカル Whisper なので追加費用ゼロ・オフライン。

## クイックスタート

```bash
# 1) ブリッジ
cd bridge && npm install
cp config.example.json config.json     # cwd を操作対象プロジェクトに、token を設定
npm start                              # ログに ws://<LAN-IP>:<port> と token が出る

# 2) グラスアプリ
cd ../glasses && npm install
npm run dev
# シミュレータ（GUI）で接続先を渡して起動
evenhub-simulator "http://localhost:5173/?bridge=ws://127.0.0.1:8765&token=YOURTOKEN"
```

実機は `glasses/README.md` の QR サイドロード手順へ。

## 操作

- テンプル1プレス … 録音開始 → もう一度で送信
- ダブルプレス … 実行中はキャンセル / アイドルは終了
- 上下スワイプ … 出力をスクロール

## 動作確認済み

- ブリッジ: hello→welcome→command→stream→result、サブスク認証で実行（API キー不要）
- セッション継続: 同一接続で session_id を保持し `--resume`、前ターンの記憶を引き継ぐ
- STT: PCM16 → WAV → whisper → transcript の配管が貫通
- グラスアプリ: 型チェック・本番ビルド・dev 配信 OK

## ハードウェア制約メモ（G2）

576×288・モノクロ16階調・テキストコンテナ中心・カメラ/スピーカー無し。
出力は色やコードブロックが落ちるため、Claude の応答はプレーンテキストで表示・ページング。
