// Drives Claude Code in headless mode and parses its stream-json output.
//
// IMPORTANT: we strip ANTHROPIC_API_KEY from the child env so usage is billed
// to the logged-in Claude subscription (Agent SDK credit), never the API.

import { spawn, type ChildProcess } from 'node:child_process';
import type { SessionSelector } from './protocol.ts';
import { log } from './log.ts';

export interface RunOptions {
  cwd: string;
  prompt: string;
  session: SessionSelector;
  permissionMode: string;
  model: string | null;
}

export interface RunCallbacks {
  onChunk?: (text: string) => void;
  onSession?: (sessionId: string) => void;
}

export interface RunResult {
  text: string;
  sessionId: string | null;
  costUsd: number | null;
}

export interface RunHandle {
  cancel: () => void;
  done: Promise<RunResult>;
}

function buildArgs(opts: RunOptions): string[] {
  const args = [
    '-p',
    opts.prompt,
    '--output-format',
    'stream-json',
    '--verbose',
    '--permission-mode',
    opts.permissionMode,
  ];
  if (opts.model) args.push('--model', opts.model);

  if (opts.session === 'continue') {
    args.push('--continue');
  } else if (opts.session && opts.session !== 'new') {
    args.push('--resume', opts.session);
  }
  // 'new' (or undefined) -> let claude create a fresh session
  return args;
}

export function runClaude(opts: RunOptions, cb: RunCallbacks = {}): RunHandle {
  const args = buildArgs(opts);
  log.debug('claude', args.filter((a) => a !== opts.prompt).join(' '));

  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;

  let child: ChildProcess;
  const done = new Promise<RunResult>((resolvePromise, reject) => {
    child = spawn('claude', args, {
      cwd: opts.cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let sessionId: string | null = null;
    let resultText = '';
    let costUsd: number | null = null;
    let resolved = false;
    let stdoutBuf = '';
    let stderr = '';

    const handleEvent = (evt: Record<string, unknown>) => {
      const sid = typeof evt.session_id === 'string' ? evt.session_id : null;
      if (sid && sid !== sessionId) {
        sessionId = sid;
        cb.onSession?.(sid);
      }

      if (evt.type === 'assistant') {
        const message = evt.message as { content?: unknown[] } | undefined;
        const content = Array.isArray(message?.content) ? message.content : [];
        for (const block of content) {
          const b = block as { type?: string; text?: string };
          if (b.type === 'text' && typeof b.text === 'string' && b.text) {
            cb.onChunk?.(b.text);
          }
        }
      } else if (evt.type === 'result') {
        if (typeof evt.result === 'string') resultText = evt.result;
        if (typeof evt.total_cost_usd === 'number') costUsd = evt.total_cost_usd;
        resolved = true;
        resolvePromise({ text: resultText, sessionId, costUsd });
      }
    };

    const drainLines = () => {
      let nl: number;
      while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
        const line = stdoutBuf.slice(0, nl).trim();
        stdoutBuf = stdoutBuf.slice(nl + 1);
        if (!line) continue;
        try {
          handleEvent(JSON.parse(line) as Record<string, unknown>);
        } catch {
          log.debug('non-json line:', line.slice(0, 200));
        }
      }
    };

    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (d: string) => {
      stdoutBuf += d;
      drainLines();
    });
    child.stderr!.on('data', (d) => (stderr += d.toString()));

    child.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error('claude CLI not found on PATH'));
      } else {
        reject(err);
      }
    });

    child.on('close', (code, signal) => {
      if (resolved) return;
      if (signal) {
        reject(new Error(`cancelled (${signal})`));
      } else {
        reject(
          new Error(
            `claude exited ${code} without a result. ${stderr.slice(-500)}`,
          ),
        );
      }
    });
  });

  return {
    cancel: () => child?.kill('SIGTERM'),
    done,
  };
}
