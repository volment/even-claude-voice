// Drives a live tmux pane: list panes (= running sessions across directories),
// capture the rendered screen for mirroring, and send typed input. This is what
// makes the glasses and the PC share ONE live Claude Code session (no fork).

import { spawn } from 'node:child_process';

export interface TmuxTarget {
  paneId: string; // e.g. %9 — stable handle for capture/send
  session: string;
  windowIndex: string;
  path: string; // current working directory of the pane
  command: string; // foreground command (claude shows its version, e.g. 2.1.181)
}

const SHELLS = new Set(['zsh', 'bash', 'fish', 'sh', '-zsh', '-bash', 'login']);

function run(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('tmux', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', (e) => {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error('tmux not found on PATH'));
      } else {
        reject(e);
      }
    });
    child.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`tmux ${args[0]} failed: ${err.trim() || code}`));
    });
  });
}

export async function tmuxAvailable(): Promise<boolean> {
  try {
    await run(['list-sessions']);
    return true;
  } catch {
    return false;
  }
}

// Lists candidate panes across the whole tmux server, hiding plain shells so the
// picker shows actual running sessions (claude, dev servers, etc.).
export async function listTargets(): Promise<TmuxTarget[]> {
  let out: string;
  try {
    out = await run([
      'list-panes',
      '-a',
      '-F',
      '#{session_name}\t#{window_index}\t#{pane_id}\t#{pane_current_path}\t#{pane_current_command}',
    ]);
  } catch {
    return [];
  }

  const targets: TmuxTarget[] = [];
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const [session, windowIndex, paneId, path, command] = line.split('\t');
    if (!paneId || !path) continue;
    if (SHELLS.has(command ?? '')) continue; // hide bare shells
    targets.push({
      paneId,
      session: session ?? '',
      windowIndex: windowIndex ?? '',
      path,
      command: command ?? '',
    });
  }
  return targets;
}

// Captures the pane (optionally including scrollback history so the user can
// scroll back through earlier conversation) and condenses it for the tiny
// glasses display: drops trailing blanks, collapses blank runs, shortens rules.
export async function capture(paneId: string, scrollback = 0): Promise<string> {
  const args = ['capture-pane', '-p'];
  if (scrollback > 0) args.push('-S', `-${scrollback}`);
  args.push('-t', paneId);
  const out = await run(args);
  let lines = out.split('\n').map((l) => l.replace(/\s+$/, ''));

  // Shorten long horizontal rules (claude's box borders/dividers).
  lines = lines.map((l) =>
    /^[\s│─━═_-]{16,}$/.test(l) ? '────────' : l,
  );

  // Collapse runs of blank lines to a single blank.
  const condensed: string[] = [];
  let blank = 0;
  for (const l of lines) {
    if (l === '') {
      blank += 1;
      if (blank <= 1) condensed.push(l);
    } else {
      blank = 0;
      condensed.push(l);
    }
  }

  while (condensed.length && condensed[0] === '') condensed.shift();
  while (condensed.length && condensed[condensed.length - 1] === '') {
    condensed.pop();
  }
  return condensed.join('\n');
}

// Types text into the pane and submits it (Enter sent separately after a beat so
// the TUI registers the input before the newline).
export async function sendText(paneId: string, text: string): Promise<void> {
  await run(['send-keys', '-t', paneId, '-l', '--', text]);
  await delay(120);
  await run(['send-keys', '-t', paneId, 'Enter']);
}

// Sends a named key (e.g. 'Escape' to interrupt, 'Up' for history).
export async function sendKey(paneId: string, key: string): Promise<void> {
  await run(['send-keys', '-t', paneId, key]);
}

// Forces the pane's window to a fixed size so the TUI re-renders to fit the
// glasses. Shared with any attached PC client (that's the cost of mirroring).
export async function resizeWindow(
  paneId: string,
  cols: number,
  rows: number,
): Promise<void> {
  await run(['set-window-option', '-t', paneId, 'window-size', 'manual']).catch(
    () => {},
  );
  await run(['resize-window', '-t', paneId, '-x', String(cols), '-y', String(rows)]);
}

// Restores automatic sizing so the PC terminal returns to normal on disconnect.
export async function resetWindowSize(paneId: string): Promise<void> {
  await run(['set-window-option', '-t', paneId, 'window-size', 'latest']).catch(
    () => {},
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
