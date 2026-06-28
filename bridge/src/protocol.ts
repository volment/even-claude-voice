// Wire protocol between the glasses app (WebView) and this bridge.
// Every frame is a single JSON object with a `type` discriminator.

// How a command should pick which Claude Code session to talk to.
//   'continue' -> resume the most recent session in the project dir
//   'new'      -> start a fresh session
//   <uuid>     -> resume that specific session id
export type SessionSelector = 'continue' | 'new' | (string & {});

// ---- Client -> Server ----

export interface HelloMsg {
  type: 'hello';
  token?: string;
  // ZK Capture sets this to 'zk'; Cloud Voice omits it (voice mode).
  clientMode?: 'zk';
}

export interface TextCommandMsg {
  type: 'command';
  text: string;
  session?: SessionSelector;
}

export interface AudioMsg {
  type: 'audio';
  // base64-encoded raw PCM, signed 16-bit little-endian, mono.
  data: string;
  sampleRate?: number; // defaults to 16000
  session?: SessionSelector;
  // 'zk' = route through Zettelkasten pipeline instead of Claude Code.
  mode?: 'claude' | 'zk';
}

// ZK: approve or skip a specific proposal block.
export interface ZkDecisionMsg {
  type: 'zk_decision';
  file: string;
  idx: number;
  action: 'approve' | 'skip';
}

// ZK: apply all approved blocks and generate zk/ cards.
export interface ZkApplyMsg {
  type: 'zk_apply';
}

export interface CancelMsg {
  type: 'cancel';
}

export interface ListSessionsMsg {
  type: 'listSessions';
}

// Load a session's conversation history for display. No id -> most recent.
export interface LoadSessionMsg {
  type: 'loadSession';
  id?: string;
}

// tmux mode: list mirror-able panes / select one to mirror & control.
export interface ListTargetsMsg {
  type: 'listTargets';
}

export interface SelectTargetMsg {
  type: 'selectTarget';
  id: string; // tmux pane id, e.g. %9
}

// tmux mode: send a single named key to the mirrored pane (for navigating
// claude's in-TUI prompts): 'Up' | 'Down' | 'Enter' | 'Escape'.
export interface KeyMsg {
  type: 'key';
  key: string;
}

export interface PingMsg {
  type: 'ping';
}

export type ClientMsg =
  | HelloMsg
  | TextCommandMsg
  | AudioMsg
  | CancelMsg
  | ListSessionsMsg
  | LoadSessionMsg
  | ZkDecisionMsg
  | ZkApplyMsg
  | ListTargetsMsg
  | SelectTargetMsg
  | KeyMsg
  | PingMsg;

// ---- Server -> Client ----

export type RunState =
  | 'idle'
  | 'transcribing'
  | 'thinking'
  | 'streaming'
  | 'done'
  | 'cancelled'
  | 'error';

export interface WelcomeMsg {
  type: 'welcome';
  cwd: string;
  model: string | null;
  permissionMode: string;
}

export interface StatusMsg {
  type: 'status';
  state: RunState;
  message?: string;
}

export interface TranscriptMsg {
  type: 'transcript';
  text: string;
}

export interface ChunkMsg {
  type: 'chunk';
  text: string;
}

export interface ResultMsg {
  type: 'result';
  text: string;
  sessionId: string | null;
  costUsd?: number;
}

export interface ErrorMsg {
  type: 'error';
  message: string;
}

export interface SessionsMsg {
  type: 'sessions';
  items: SessionSummary[];
}

// A session's conversation history, sent on connect (or on loadSession).
export interface HistoryMsg {
  type: 'history';
  sessionId: string | null;
  text: string;
  turns: number;
}

export interface TargetSummary {
  id: string; // tmux pane id
  label: string; // e.g. "even" / "slot-setting-guesses"
  path: string;
  command: string;
  isClaude: boolean;
}

// tmux mode: the list of panes the glasses can pick from.
export interface TargetsMsg {
  type: 'targets';
  items: TargetSummary[];
}

// tmux mode: a snapshot of the mirrored pane's screen.
export interface ScreenMsg {
  type: 'screen';
  text: string;
}

export interface PongMsg {
  type: 'pong';
}

export interface SessionSummary {
  id: string;
  updatedAt: number;
  preview: string;
}

// ZK: list of pending proposal blocks (returned after STT + process-inbox.sh).
export interface ZkProposal {
  file: string;
  idx: number;
  kind: string;
  title: string;
  body: string;
}

export interface ZkProposalsMsg {
  type: 'zk_proposals';
  items: ZkProposal[];
}

// ZK: returned after apply-proposal.js finishes.
export interface ZkApplyDoneMsg {
  type: 'zk_apply_done';
  count: number;
}

export type ServerMsg =
  | WelcomeMsg
  | StatusMsg
  | TranscriptMsg
  | ChunkMsg
  | ResultMsg
  | ErrorMsg
  | SessionsMsg
  | HistoryMsg
  | TargetsMsg
  | ScreenMsg
  | PongMsg
  | ZkProposalsMsg
  | ZkApplyDoneMsg;
