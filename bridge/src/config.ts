// Builds bridge configuration from (in priority order):
//   1. environment variables (e.g. from a .env file)
//   2. an optional config.json
//   3. built-in defaults
//
// Nothing environment-specific is hardcoded: token, cwd, IPs, etc. all come
// from env / config at runtime.

import { readFileSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { randomBytes } from 'node:crypto';
import { log } from './log.ts';

export interface WhisperConfig {
  bin: string;
  model: string;
  language: string | null;
  // Biases recognition toward expected phrasing (helps with homophones and
  // command-style speech). Passed to whisper as --initial_prompt.
  initialPrompt: string | null;
}

export interface Config {
  host: string;
  port: number;
  token: string;
  cwd: string;
  permissionMode: string;
  model: string | null;
  autoSendAfterTranscribe: boolean;
  whisper: WhisperConfig;
  // 'tmux' = live-mirror a real tmux pane (shared with PC, no fork).
  // 'headless' = spawn `claude -p --resume` per command (separate process).
  mode: 'tmux' | 'headless';
  tmux: TmuxOptions;
}

export interface TmuxOptions {
  // How often to capture the pane and push it to the glasses (ms).
  pollMs: number;
  // Resize the mirrored window to these dims so the TUI fits the glasses
  // cleanly (no ugly wrapping). PC clients attached to the window share this
  // size while mirrored, and it's restored on disconnect.
  cols: number;
  rows: number;
  // How many lines of tmux scrollback to include so the user can scroll back
  // through earlier conversation (0 = visible screen only).
  scrollback: number;
}

const VALID_PERMISSION_MODES = new Set([
  'default',
  'acceptEdits',
  'plan',
  'bypassPermissions',
]);

function fail(msg: string): never {
  log.error(`config: ${msg}`);
  process.exit(1);
}

// --- env helpers ---
function envStr(key: string): string | undefined {
  const v = process.env[key];
  return v !== undefined && v.length > 0 ? v : undefined;
}
function envNum(key: string): number | undefined {
  const v = process.env[key];
  if (v === undefined || v.length === 0) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function envBool(key: string): boolean | undefined {
  const v = process.env[key];
  if (v === undefined || v.length === 0) return undefined;
  return v === 'true' || v === '1' || v === 'yes';
}

function readJson(configPath?: string): Record<string, unknown> {
  if (!configPath) return {};
  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf8')) as unknown;
    if (typeof raw === 'object' && raw !== null) {
      return raw as Record<string, unknown>;
    }
    fail('config root must be a JSON object');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    fail(`cannot read ${configPath}: ${(err as Error).message}`);
  }
}

export function loadConfig(configPath?: string): Config {
  const c = readJson(configPath);
  const w =
    typeof c.whisper === 'object' && c.whisper !== null
      ? (c.whisper as Record<string, unknown>)
      : {};
  const t =
    typeof c.tmux === 'object' && c.tmux !== null
      ? (c.tmux as Record<string, unknown>)
      : {};

  const jsonStr = (v: unknown): string | undefined =>
    typeof v === 'string' && v.length > 0 ? v : undefined;
  const jsonNum = (v: unknown): number | undefined =>
    typeof v === 'number' ? v : undefined;

  const rawCwd = envStr('BRIDGE_CWD') ?? jsonStr(c.cwd) ?? '.';
  const cwd = isAbsolute(rawCwd) ? rawCwd : resolve(process.cwd(), rawCwd);

  let token = envStr('BRIDGE_TOKEN') ?? jsonStr(c.token) ?? '';
  if (token.length === 0) {
    token = randomBytes(9).toString('base64url');
    log.warn(`no token set (BRIDGE_TOKEN / config) — generated one: ${token}`);
    log.warn('pass this exact token to the glasses app (?token=...).');
  }

  const permissionMode =
    envStr('BRIDGE_PERMISSION_MODE') ?? jsonStr(c.permissionMode) ?? 'acceptEdits';
  if (!VALID_PERMISSION_MODES.has(permissionMode)) {
    fail(
      `permissionMode must be one of ${[...VALID_PERMISSION_MODES].join(', ')}`,
    );
  }
  if (permissionMode === 'bypassPermissions') {
    log.warn(
      'permissionMode=bypassPermissions: Claude runs tools (incl. Bash) without asking. Trusted LAN only.',
    );
  }

  const mode =
    (envStr('BRIDGE_MODE') ?? jsonStr(c.mode)) === 'tmux' ? 'tmux' : 'headless';

  return {
    host: envStr('BRIDGE_HOST') ?? jsonStr(c.host) ?? '0.0.0.0',
    port: envNum('BRIDGE_PORT') ?? jsonNum(c.port) ?? 8765,
    token,
    cwd,
    permissionMode,
    model: envStr('BRIDGE_MODEL') ?? jsonStr(c.model) ?? null,
    autoSendAfterTranscribe:
      envBool('BRIDGE_AUTO_SEND') ??
      (typeof c.autoSendAfterTranscribe === 'boolean'
        ? c.autoSendAfterTranscribe
        : false),
    whisper: {
      bin: envStr('WHISPER_BIN') ?? jsonStr(w.bin) ?? 'whisper',
      model: envStr('WHISPER_MODEL') ?? jsonStr(w.model) ?? 'turbo',
      language: envStr('WHISPER_LANGUAGE') ?? jsonStr(w.language) ?? null,
      initialPrompt:
        envStr('WHISPER_INITIAL_PROMPT') ?? jsonStr(w.initialPrompt) ?? null,
    },
    mode,
    tmux: {
      pollMs: envNum('TMUX_POLL_MS') ?? jsonNum(t.pollMs) ?? 700,
      cols: envNum('TMUX_COLS') ?? jsonNum(t.cols) ?? 50,
      rows: envNum('TMUX_ROWS') ?? jsonNum(t.rows) ?? 28,
      scrollback: envNum('TMUX_SCROLLBACK') ?? jsonNum(t.scrollback) ?? 200,
    },
  };
}
