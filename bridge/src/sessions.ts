// Lists past Claude Code sessions for the target project dir so the glasses can
// pick one to resume. Best-effort: returns [] if the store layout is unknown.

import { readdir, stat, open, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { SessionSummary } from './protocol.ts';
import { log } from './log.ts';

// Claude encodes a project path into a folder name by replacing every
// non-alphanumeric char with '-'. e.g. /Users/me/app -> -Users-me-app
function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

function candidateBases(): string[] {
  const home = homedir();
  return [
    join(home, '.claude', 'projects'),
    join(home, '.config', 'claude-code', 'projects'),
  ];
}

async function firstUserPreview(filePath: string): Promise<string> {
  const fh = await open(filePath, 'r');
  try {
    let buf = '';
    for await (const chunk of fh.createReadStream({ encoding: 'utf8' })) {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const evt = JSON.parse(line) as {
            type?: string;
            message?: { role?: string; content?: unknown };
          };
          if (evt.type === 'user' || evt.message?.role === 'user') {
            const text = extractText(evt.message?.content);
            if (text) return text.slice(0, 80);
          }
        } catch {
          /* skip malformed line */
        }
      }
      if (buf.length > 64_000) break; // preview only; don't read whole file
    }
  } finally {
    await fh.close();
  }
  return '(no preview)';
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    for (const block of content) {
      const b = block as { type?: string; text?: string };
      if (b.type === 'text' && typeof b.text === 'string') return b.text;
    }
  }
  return '';
}

// Finds the Claude Code project dir that holds this cwd's session files.
async function findProjectDir(cwd: string): Promise<string | null> {
  const encoded = encodeProjectDir(cwd);
  for (const base of candidateBases()) {
    const projectDir = join(base, encoded);
    try {
      const files = await readdir(projectDir);
      if (files.some((f) => f.endsWith('.jsonl'))) return projectDir;
    } catch {
      continue;
    }
  }
  return null;
}

// Pulls all text blocks (skipping tool_use / tool_result noise) from a message.
function extractAllText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    const b = block as { type?: string; text?: string };
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
  }
  return parts.join('\n').trim();
}

export interface LoadedSession {
  id: string;
  text: string; // formatted conversation, capped to the recent tail
  turns: number;
}

const TRANSCRIPT_CAP = 6000;

// Loads a session's conversation as a readable transcript for the glasses.
// Without an id, picks the most recently modified session in the project.
export async function loadTranscript(
  cwd: string,
  id?: string,
): Promise<LoadedSession | null> {
  const dir = await findProjectDir(cwd);
  if (!dir) return null;

  let fileId = id;
  if (!fileId) {
    const files = (await readdir(dir)).filter((f) => f.endsWith('.jsonl'));
    let best: { id: string; m: number } | null = null;
    for (const f of files) {
      try {
        const s = await stat(join(dir, f));
        if (!best || s.mtimeMs > best.m) {
          best = { id: f.replace(/\.jsonl$/, ''), m: s.mtimeMs };
        }
      } catch {
        /* skip */
      }
    }
    if (!best) return null;
    fileId = best.id;
  }

  let raw: string;
  try {
    raw = await readFile(join(dir, `${fileId}.jsonl`), 'utf8');
  } catch {
    return null;
  }

  const turns: string[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let evt: { type?: string; message?: { role?: string; content?: unknown } };
    try {
      evt = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const role = evt.message?.role ?? evt.type;
    if (role !== 'user' && role !== 'assistant') continue;
    const text = extractAllText(evt.message?.content);
    if (!text) continue;
    // Skip injected context/system reminders that aren't real conversation.
    if (text.includes('<system-reminder>') || text.includes('<command-name>')) {
      continue;
    }
    turns.push(role === 'user' ? `» ${text}` : text);
  }

  let text = turns.join('\n\n');
  if (text.length > TRANSCRIPT_CAP) {
    text = `…(earlier history omitted)…\n\n${text.slice(text.length - TRANSCRIPT_CAP)}`;
  }
  return { id: fileId, text, turns: turns.length };
}

export async function listSessions(cwd: string): Promise<SessionSummary[]> {
  const encoded = encodeProjectDir(cwd);

  for (const base of candidateBases()) {
    const projectDir = join(base, encoded);
    let files: string[];
    try {
      files = (await readdir(projectDir)).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue; // try next base
    }
    if (files.length === 0) continue;

    const summaries: SessionSummary[] = [];
    for (const file of files) {
      const full = join(projectDir, file);
      try {
        const s = await stat(full);
        summaries.push({
          id: file.replace(/\.jsonl$/, ''),
          updatedAt: s.mtimeMs,
          preview: await firstUserPreview(full),
        });
      } catch (err) {
        log.debug('session stat failed', file, (err as Error).message);
      }
    }
    summaries.sort((a, b) => b.updatedAt - a.updatedAt);
    return summaries.slice(0, 20);
  }

  return [];
}
