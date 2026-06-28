// 01-inbox/ を監視して新しい .md ファイルが現れたら自動で ZK パイプラインを回す。
// スマホの Obsidian (LiveSync) や手書きメモからの取り込みに対応。

import { watch } from 'node:fs';
import { join, basename } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { runProcessInbox } from './zk.ts';
import { log } from './log.ts';

const DEBOUNCE_MS = 3000; // LiveSync が書き終わるまで少し待つ

export function startInboxWatcher(zkRoot: string): void {
  const inboxDir = join(zkRoot, '01-inbox');
  if (!existsSync(inboxDir)) {
    log.warn(`watch: 01-inbox/ が見つかりません: ${inboxDir}`);
    return;
  }

  // 起動時点で既にある .md ファイルは処理済みとしてマーク
  const seen = new Set(
    readdirSync(inboxDir).filter((f) => f.endsWith('.md') && f !== 'README.md'),
  );

  let timer: ReturnType<typeof setTimeout> | null = null;

  watch(inboxDir, (event, filename) => {
    if (!filename || !filename.endsWith('.md') || filename === 'README.md') return;
    // voice-*.md はブリッジの WebSocket パイプラインが処理する。ここでは触らない。
    if (filename.startsWith('voice-')) return;
    if (seen.has(filename)) return; // 既知のファイル（またはエラー追記）は無視

    const fullPath = join(inboxDir, filename);
    if (!existsSync(fullPath)) return; // 削除イベントは無視

    seen.add(filename);
    log.info(`watch: 新ファイル検知 → ${filename}`);

    // debounce: LiveSync が複数回書き込む場合に備える
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      try {
        runProcessInbox(zkRoot);
      } catch (err) {
        log.warn('watch: runProcessInbox 失敗:', (err as Error).message);
      }
    }, DEBOUNCE_MS);
  });

  log.info(`watch: 01-inbox/ を監視中 (新ファイルを自動処理)`);
}
