# even-claude-bridge

Even G2 グラスから Claude Code を**音声で**操作するためのブリッジサーバー。
グラスアプリ（WebView）から LAN 経由で接続し、音声をローカル Whisper で文字起こし →
`claude` をヘッドレス実行 → 出力をストリームで返す。

```
[G2] --BT--> [スマホ WebView: グラスアプリ] --WS(LAN)--> [このブリッジ (Mac/Linux)]
                                                          ├ Whisper(ローカルSTT)
                                                          └ claude -p (サブスク認証)
```

## 課金について（重要）

- ブリッジは `claude` CLI をヘッドレス実行する際、子プロセスから **`ANTHROPIC_API_KEY` を必ず除去**する。
  これにより、ログイン済みの **Claude サブスクリプション（Agent SDK 月次クレジット）** で動作し、API 従量課金にならない。
- 事前に **Agent SDK クレジットのオプトイン**（claude.ai / サポートで一度だけ有効化）を済ませること。
- シェルに `ANTHROPIC_API_KEY` を設定しないこと（ブリッジは除去するが、念のため）。

## 必要なもの

- Node.js 22+（ネイティブ TS 実行 or tsx）
- `claude` CLI（ログイン済み・サブスク）
- `whisper`（openai-whisper）と `ffmpeg`
  - `pip install -U openai-whisper`
  - `brew install ffmpeg`（または同等）

## セットアップ

設定は **環境変数(.env)** が第一。IP・トークン・パス等の環境依存値はここに置く（`.env` は gitignore 済み）。

```bash
cd bridge
npm install
cp .env.example .env   # 編集する（最低限 BRIDGE_TOKEN）
npm start
```

起動すると、グラスアプリに設定すべき `ws://<LAN-IP>:<port>` とトークンが表示される。

### 設定の優先順位

1. **環境変数 / `.env`**（推奨）
2. **`config.json`**（任意。`cp config.example.json config.json`。パスは引数か `BRIDGE_CONFIG` でも指定可）
3. 組み込みデフォルト

env と config.json は併用でき、env が優先される。どちらも無くても（トークン自動生成で）起動する。

### 主な環境変数

| env | config.json キー | 説明 |
|---|---|---|
| `BRIDGE_HOST` | `host` | バインドアドレス（LAN公開は `0.0.0.0`） |
| `BRIDGE_PORT` | `port` | WebSocket ポート |
| `BRIDGE_TOKEN` | `token` | 接続トークン（空なら自動生成して表示） |
| `BRIDGE_MODE` | `mode` | `tmux`（PCと共有ミラー）/ `headless` |
| `BRIDGE_CWD` | `cwd` | headless時の対象プロジェクト |
| `BRIDGE_PERMISSION_MODE` | `permissionMode` | `default`/`acceptEdits`/`plan`/`bypassPermissions` |
| `BRIDGE_AUTO_SEND` | `autoSendAfterTranscribe` | `false`=送信前に確認 |
| `WHISPER_MODEL` / `WHISPER_LANGUAGE` / `WHISPER_INITIAL_PROMPT` | `whisper.*` | STT設定 |
| `TMUX_COLS` / `TMUX_ROWS` / `TMUX_SCROLLBACK` / `TMUX_POLL_MS` | `tmux.*` | ミラー調整 |

全キーは `.env.example` 参照。

## config.json

| キー | 説明 | 既定 |
|---|---|---|
| `host` | バインドアドレス。LAN 公開は `0.0.0.0` | `0.0.0.0` |
| `port` | WebSocket ポート | `8765` |
| `token` | 接続トークン。空なら起動時に自動生成して表示 | （自動生成） |
| `cwd` | **claude を動かす対象プロジェクトのディレクトリ**。相対パスは config からの相対 | `.` |
| `permissionMode` | `default` / `acceptEdits` / `plan` / `bypassPermissions` | `acceptEdits` |
| `model` | 使うモデル（任意） | `null` |
| `autoSendAfterTranscribe` | 文字起こし後そのまま claude に送るか | `true` |
| `whisper.bin` | whisper 実行コマンド | `whisper` |
| `whisper.model` | `tiny`/`base`/`small`/`medium`/`large`。日本語実用なら `small` 以上推奨 | `base` |
| `whisper.language` | 認識言語を固定（例 `ja` / `en`）。`null` で自動判定 | `null` |

> `cwd` がそのままセッションのスコープになる。指定プロジェクト配下の Claude Code セッションを
> `--continue`/`--resume` で続きから操作する。

> `permissionMode` を `bypassPermissions` にすると Bash 含む全ツールを無確認実行する。
> グラスから許可ダイアログに答えられないため自動化は進むが、**信頼できる LAN でのみ**使うこと。

## セッションの選び方（「続きから」）

クライアントが各コマンドで `session` を指定できる：

- `"continue"` … 対象 dir の**最新セッション**を再開
- `"new"` … 新規セッション
- `"<uuid>"` … 指定 ID を再開
- 省略 … 同一接続で**直前に使ったセッションを継続**（無ければ最新を continue）

`listSessions` で過去セッション一覧（ID・更新時刻・冒頭プレビュー）を取得できる。

## WebSocket プロトコル

すべて 1 フレーム = 1 JSON。型は `src/protocol.ts` を参照。

クライアント → サーバー:

```jsonc
{ "type": "hello", "token": "..." }
{ "type": "command", "text": "テスト書いて", "session": "continue" }
{ "type": "audio", "data": "<base64 PCM16 mono>", "sampleRate": 16000, "session": "new" }
{ "type": "cancel" }
{ "type": "listSessions" }
{ "type": "ping" }
```

サーバー → クライアント:

```jsonc
{ "type": "welcome", "cwd": "...", "model": null, "permissionMode": "acceptEdits" }
{ "type": "status", "state": "transcribing|thinking|streaming|done|cancelled|error|idle" }
{ "type": "transcript", "text": "..." }      // 文字起こし結果
{ "type": "chunk", "text": "..." }           // 逐次出力
{ "type": "result", "text": "...", "sessionId": "...", "costUsd": 0.0 }
{ "type": "sessions", "items": [{ "id", "updatedAt", "preview" }] }
{ "type": "error", "message": "..." }
{ "type": "pong" }
```

## セキュリティ

- ブリッジは Claude Code 経由で**コマンド実行できる**ため、LAN への公開はリスク。
  必ずトークンを設定し、信頼できるネットワークでのみ起動する。
- 外部公開する場合は逆プロキシ + TLS（`wss://`）を前段に置くこと。

## トラブルシュート

- `whisper binary not found` → `pip install -U openai-whisper`、`whisper.bin` のパス確認。
- 認識がおかしい → `whisper.model` を `small`/`medium` に、`whisper.language` を `ja` 等に固定。
- claude が結果を返さない → `cwd` がログイン済み環境から見えるか、`permissionMode` がツール実行を許すか確認。
