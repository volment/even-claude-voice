// Wire protocol shared with the bridge server (client-side view).
// Keep in sync with bridge/src/protocol.ts.

export type SessionSelector = 'continue' | 'new' | (string & {});

export type ClientMsg =
  | { type: 'hello'; token?: string }
  | { type: 'command'; text: string; session?: SessionSelector }
  | { type: 'audio'; data: string; sampleRate?: number; session?: SessionSelector }
  | { type: 'cancel' }
  | { type: 'listSessions' }
  | { type: 'loadSession'; id?: string }
  | { type: 'listTargets' }
  | { type: 'selectTarget'; id: string }
  | { type: 'ping' };

export interface TargetSummary {
  id: string;
  label: string;
  path: string;
  command: string;
  isClaude: boolean;
}

export type RunState =
  | 'idle'
  | 'transcribing'
  | 'thinking'
  | 'streaming'
  | 'done'
  | 'cancelled'
  | 'error';

export interface SessionSummary {
  id: string;
  updatedAt: number;
  preview: string;
}

export type ServerMsg =
  | { type: 'welcome'; cwd: string; model: string | null; permissionMode: string }
  | { type: 'status'; state: RunState; message?: string }
  | { type: 'transcript'; text: string }
  | { type: 'chunk'; text: string }
  | { type: 'result'; text: string; sessionId: string | null; costUsd?: number }
  | { type: 'sessions'; items: SessionSummary[] }
  | { type: 'history'; sessionId: string | null; text: string; turns: number }
  | { type: 'targets'; items: TargetSummary[] }
  | { type: 'screen'; text: string }
  | { type: 'error'; message: string }
  | { type: 'pong' };
