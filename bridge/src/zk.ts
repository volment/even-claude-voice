// Zettelkasten pipeline: create inbox note → proposals → apply.
// Runs entirely on the Mac alongside the bridge — no external API needed.
// All long-running calls are async so they never block the WebSocket event loop.

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, appendFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ZkProposal } from './protocol.ts';
import { log } from './log.ts';

const execFileP = promisify(execFile);

// Spawn a subprocess with text piped to stdin. Returns stdout on success.
function runWithStdin(
  cmd: string,
  args: string[],
  input: string,
  opts: { env?: NodeJS.ProcessEnv; timeout?: number },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: opts.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { err += d.toString(); });
    child.on('error', reject);
    const timer = opts.timeout
      ? setTimeout(() => { child.kill(); reject(new Error(`timeout after ${opts.timeout}ms`)); }, opts.timeout)
      : null;
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) {
        resolve(out);
      } else {
        const e = Object.assign(new Error(`exited ${String(code)}`), { stderr: err, stdout: out });
        reject(e);
      }
    });
    child.stdin.write(input, 'utf8');
    child.stdin.end();
  });
}

// ── Proposal block parser ─────────────────────────────────────────────────
function parseBlocks(content: string): Array<{ idx: number; status: string; kind: string; title: string; body: string }> {
  return content.split('\n===\n').map((raw, idx) => {
    const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!m || !m[1] || !m[2]) return null;
    const fm = m[1];
    const bodyRaw = m[2].trim();
    const status = (fm.match(/^status:\s*(\S+)/m) ?? [])[1] ?? '';
    const kind   = (fm.match(/^kind:\s*(.+)/m)   ?? [])[1]?.trim() ?? '';
    const fullText = bodyRaw.split('\n').filter((l) => l.trim()).join('\n');
    const title    = fullText.replace(/^#+\s*/, '').slice(0, 40);
    return { idx, status, kind, title, body: fullText.slice(0, 500) };
  }).filter((b): b is NonNullable<typeof b> => b !== null);
}

function setBlockStatus(content: string, blockIdx: number, newStatus: string): string {
  const parts = content.split('\n===\n');
  if (!parts[blockIdx]) return content;
  parts[blockIdx] = parts[blockIdx].replace(/^(status:\s*)\S+/m, `$1${newStatus}`);
  return parts.join('\n===\n');
}

// ── Public API ────────────────────────────────────────────────────────────

export function createInboxNote(zkRoot: string, text: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fname = `voice-${ts}.md`;
  writeFileSync(join(zkRoot, '01-inbox', fname), text + '\n', 'utf8');
  log.info(`zk: 01-inbox/${fname}`);
  return fname;
}

export async function runProcessInbox(zkRoot: string): Promise<void> {
  log.info('zk: generating proposals…');

  const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.config', 'claude-code');
  const claudeEnv = { ...process.env, CLAUDE_CONFIG_DIR: claudeConfigDir };

  const promptTmpl = readFileSync(join(zkRoot, '.system', 'prompts', 'process-inbox.md'), 'utf8');

  let context = '';
  try {
    const { stdout } = await execFileP(
      'bash',
      [join(zkRoot, '.system', 'bin', 'zk-context.sh')],
      { cwd: zkRoot, encoding: 'utf8', timeout: 30_000 },
    );
    context = stdout;
  } catch (err) {
    log.warn('zk: zk-context.sh failed:', (err as Error).message);
  }

  const proposalsDir = join(zkRoot, '01-inbox', '_proposals');
  const inboxDir = join(zkRoot, '01-inbox');
  if (!existsSync(proposalsDir)) mkdirSync(proposalsDir, { recursive: true });

  for (const base of readdirSync(inboxDir).filter((f) => f.endsWith('.md') && f !== 'README.md')) {
    const out = join(proposalsDir, base);
    if (existsSync(out)) { log.info(`zk: skip (proposal exists): ${base}`); continue; }

    const inboxText = readFileSync(join(inboxDir, base), 'utf8');
    const fullPrompt = `${promptTmpl}\n\n# ZK_CONTEXT\n${context}\n\n# INBOX_TEXT\n${inboxText}`;

    log.info(`zk: processing ${base}…`);
    try {
      const raw = await runWithStdin(
        'claude',
        ['-p', '--allowedTools', 'Read'],
        fullPrompt,
        { env: claudeEnv, timeout: 120_000 },
      );
      const trimmed = raw.replace(/^```[^\n]*\n?/, '').replace(/\n?```\s*$/, '').trim();
      if (trimmed.startsWith('SKIP:')) {
        const reason = trimmed.slice(5).trim();
        log.info(`zk: skip for ${base}: ${reason}`);
        const date = new Date().toISOString().slice(0, 10);
        appendFileSync(join(inboxDir, base), `\n\n---\nZKスキップ済み (${date}): ${reason}\n`, 'utf8');
      } else if (trimmed) {
        writeFileSync(out, trimmed + '\n', 'utf8');
        log.info(`zk: wrote proposal for ${base}`);
      } else {
        log.warn(`zk: claude returned empty for ${base}`);
        const date = new Date().toISOString().slice(0, 10);
        appendFileSync(join(inboxDir, base), `\n\n---\nZKスキップ済み (${date}): AIが応答を返しませんでした\n`, 'utf8');
      }
    } catch (err) {
      const e = err as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
      const detail = e.stderr?.trim() || e.stdout?.trim() || e.message;
      log.warn(`zk: claude failed for ${base}:`, detail);
      const date = new Date().toISOString().slice(0, 10);
      appendFileSync(join(inboxDir, base), `\n\n---\nZKエラー (${date}): claude -p が失敗しました — ${detail.slice(0, 200)}\n`, 'utf8');
    }
  }
}

export function getPendingProposals(zkRoot: string): ZkProposal[] {
  const dir = join(zkRoot, '01-inbox', '_proposals');
  if (!existsSync(dir)) return [];
  const result: ZkProposal[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    const content = readFileSync(join(dir, file), 'utf8');
    for (const b of parseBlocks(content)) {
      if (b.status === 'proposed') {
        result.push({ file, idx: b.idx, kind: b.kind, title: b.title, body: b.body });
      }
    }
  }
  return result;
}

export function applyDecision(zkRoot: string, file: string, idx: number, action: 'approve' | 'skip'): void {
  const fp = join(zkRoot, '01-inbox', '_proposals', file);
  const content = readFileSync(fp, 'utf8');
  const newStatus = action === 'approve' ? 'approved' : 'skipped';
  writeFileSync(fp, setBlockStatus(content, idx, newStatus), 'utf8');
  log.info(`zk: ${action} ${file}[${idx}]`);
}

export async function applyApproved(zkRoot: string): Promise<number> {
  const applyScript = join(zkRoot, '.system', 'bin', 'apply-proposal.js');
  const fixScript   = join(zkRoot, '.system', 'bin', 'fix-related-links.js');
  const { stdout: out } = await execFileP('node', [applyScript], { cwd: zkRoot, timeout: 60_000, encoding: 'utf8' });
  await execFileP('node', [fixScript], { cwd: zkRoot, timeout: 30_000 });
  const count = (out.match(/→ 02-zk\//g) ?? []).length;
  log.info(`zk: apply done — ${count} cards`);
  return count;
}
