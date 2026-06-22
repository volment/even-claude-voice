// Even G2 voice client for Claude Code.
//
// Press temple        -> start/stop voice recording (sends audio to the bridge)
// Double press        -> cancel a running command, or exit when idle
// Swipe up / down     -> page through Claude's output
//
// The bridge transcribes the audio locally (Whisper) and drives Claude Code,
// streaming the result back here for display.

import {
  waitForEvenAppBridge,
  OsEventTypeList,
  type EvenHubEvent,
} from '@evenrealities/even_hub_sdk';
import { loadConfig } from './config.ts';
import { BridgeConn } from './conn.ts';
import { Recorder } from './recorder.ts';
import { GlassesUI } from './glasses-ui.ts';
import type { ServerMsg, TargetSummary } from './protocol.ts';

type Phase = 'config' | 'connecting' | 'idle' | 'recording' | 'busy' | 'error';

// Writes early boot diagnostics to the phone WebView so a blank screen becomes
// readable. Replaced by the glasses mirror once the UI is up.
function boot(msg: string): void {
  if (typeof document === 'undefined') return;
  let el = document.getElementById('boot');
  if (!el) {
    el = document.createElement('pre');
    el.id = 'boot';
    el.style.cssText =
      'margin:0;padding:12px;min-height:100vh;background:#000;color:#36ff6a;font:14px/1.4 ui-monospace,Menlo,monospace;white-space:pre-wrap';
    document.body.appendChild(el);
  }
  el.textContent += msg + '\n';
}

// On-screen debug log (bottom overlay on the phone) — shows incoming hardware
// events and actions so we can diagnose unresponsive taps.
const dbgLines: string[] = [];
function dbg(msg: string): void {
  if (typeof document === 'undefined') return;
  let el = document.getElementById('dbg');
  if (!el) {
    el = document.createElement('pre');
    el.id = 'dbg';
    el.style.cssText =
      'position:fixed;left:0;right:0;bottom:0;max-height:45vh;overflow:auto;margin:0;padding:8px;background:rgba(0,0,0,.85);color:#9ad;border-top:1px solid #355;font:12px/1.3 ui-monospace,Menlo,monospace;white-space:pre-wrap;z-index:9999';
    document.body.appendChild(el);
  }
  dbgLines.push(msg);
  while (dbgLines.length > 14) dbgLines.shift();
  el.textContent = dbgLines.join('\n');
}

async function main(): Promise<void> {
  boot('booting…');
  boot('waiting for Even bridge…');
  const bridge = await waitForEvenAppBridge();
  boot('bridge ready ✓');
  document.getElementById('boot')?.remove(); // mirror takes over from here
  const ui = new GlassesUI(bridge);
  await ui.init();

  const config = await loadConfig(bridge);
  if (!config.bridgeUrl || !config.token) {
    ui.setHeader('⚙ setup needed');
    ui.setBody(
      'No bridge configured.\n\nReload with query params, e.g.\n' +
        '?bridge=ws://192.168.0.10:8765&token=YOURTOKEN\n\n' +
        '(or edit DEFAULTS in src/config.ts)',
    );
    return;
  }

  const recorder = new Recorder();

  // appMode drives what the gestures do and what's on screen:
  //   picker   — choose which tmux session (directory) to mirror
  //   mirror   — live view of the chosen pane; talk to type into it
  //   confirm  — review the transcribed message, Yes/No before sending
  //   headless — legacy: history + one-shot Q&A (config.mode='headless')
  type AppMode = 'connecting' | 'picker' | 'mirror' | 'confirm' | 'headless';
  let appMode: AppMode = 'connecting';
  let phase: Phase = 'connecting';

  // picker state
  let targets: TargetSummary[] = [];
  let cursor = 0;

  // confirm state
  let pendingText = '';
  let confirmYes = true; // highlight Yes by default
  let lastScreen = ''; // last mirrored screen, to restore after confirm

  // mirror state — follow the latest unless the user scrolled up to read
  let followScreen = true;

  // headless conversation state
  let history = '';
  let response = '';
  let transcript = '';

  // Select mode: answer claude's in-TUI prompts by sending arrow/Enter keys.
  // Entered with a left-temple tap in the mirror; voice is disabled while on.
  let selectMode = false;

  const setPhase = (p: Phase, headerOverride?: string): void => {
    phase = p;
    ui.setHeader(headerOverride ?? defaultHeader(p));
  };

  const truncate = (s: string, n: number): string =>
    s.length > n ? `${s.slice(0, n)}…` : s;

  function mirrorHeader(): string {
    if (selectMode) return '◉ 選択: スワイプ移動 · 左tap決定';
    return recorder.isActive
      ? '● REC — 右tapで送信'
      : '▶ 右tap=talk · 左tap=選択 · 2-press=list';
  }

  function targetLabel(t: TargetSummary): string {
    return `${t.label}${t.isClaude ? '' : ` ·${t.command}`}`;
  }

  function showPicker(): void {
    cursor = 0;
    appMode = 'picker';
    renderPicker();
  }

  function renderPicker(): void {
    const n = targets.length;
    if (n === 0) {
      ui.setBody('(no sessions — run claude in tmux)', false);
      setPhase('idle', '↕ refresh');
      return;
    }
    // Window the list around the cursor so it never overflows the screen — this
    // keeps the firmware from adding its own scrollbar that fights the cursor.
    const VISIBLE = 6;
    let start = cursor - Math.floor(VISIBLE / 2);
    start = Math.max(0, Math.min(start, Math.max(0, n - VISIBLE)));
    const end = Math.min(n, start + VISIBLE);
    const lines: string[] = [];
    if (start > 0) lines.push('  ⋯');
    for (let i = start; i < end; i++) {
      lines.push(`${i === cursor ? '▶ ' : '  '}${targetLabel(targets[i])}`);
    }
    if (end < n) lines.push('  ⋯');
    ui.setBody(lines.join('\n'), false);
    setPhase('idle', `${cursor + 1}/${n} ↕cycle 2-press`);
  }

  // Wrap-around so a single reliable swipe direction can reach every item
  // (this hardware only reliably emits swipe-up). Debounced because one physical
  // swipe often fires the event twice (which would jump two items).
  let lastMoveAt = 0;
  function moveCursor(delta: number): void {
    const n = targets.length;
    if (n === 0) return;
    const now = performance.now();
    if (now - lastMoveAt < 400) return;
    lastMoveAt = now;
    cursor = (cursor + delta + n) % n;
    renderPicker();
  }

  function renderConfirm(): void {
    const body =
      `Send this?\n\n» ${pendingText}\n\n` +
      `${confirmYes ? '▶ ' : '  '}Yes — send\n` +
      `${confirmYes ? '  ' : '▶ '}No — cancel`;
    ui.setBody(body, false);
    setPhase('idle', '↕ Yes/No · tap=決定');
  }

  function toggleConfirm(): void {
    const now = performance.now();
    if (now - lastMoveAt < 280) return;
    lastMoveAt = now;
    confirmYes = !confirmYes;
    renderConfirm();
  }

  // Headless: compose prior history + the in-flight turn.
  function render(): string {
    const live =
      (transcript ? `» ${transcript}` : '') +
      (transcript && response ? '\n' : '') +
      (response ? response : '');
    if (!history) return live;
    return live ? `${history}\n\n${live}` : history;
  }

  function handleServer(msg: ServerMsg): void {
    switch (msg.type) {
      case 'welcome':
        setPhase('connecting', '… connecting');
        ui.setBody('Connected…');
        break;
      case 'targets':
        targets = msg.items;
        showPicker();
        break;
      case 'screen':
        lastScreen = msg.text;
        if (appMode === 'confirm') break; // don't clobber the Yes/No prompt
        appMode = 'mirror';
        // Follow the latest unless the user scrolled up to read past output.
        ui.setBody(msg.text, followScreen);
        if (phase === 'idle') ui.setHeader(mirrorHeader());
        break;
      case 'transcript':
        if (appMode === 'headless') {
          transcript = msg.text;
          response = '';
          ui.setBody(render());
          setPhase('busy', '… thinking');
        } else if (msg.text) {
          // tmux: confirm the message before sending it to the session.
          pendingText = msg.text;
          confirmYes = true;
          appMode = 'confirm';
          renderConfirm();
        } else {
          setPhase('idle', mirrorHeader());
        }
        break;
      case 'history':
        appMode = 'headless';
        history = msg.text;
        transcript = '';
        response = '';
        ui.setBody(render());
        setPhase('idle', `▶ ${msg.turns} turns — 2-press to talk`);
        break;
      case 'chunk':
        response += msg.text;
        ui.setBody(render());
        setPhase('busy', '… streaming');
        break;
      case 'result':
        if (msg.text) response = msg.text;
        history = render();
        transcript = '';
        response = '';
        ui.setBody(history);
        setPhase('idle');
        break;
      case 'status':
        if (msg.state === 'transcribing') setPhase('busy', '… transcribing');
        else if (msg.state === 'cancelled') setPhase('idle', '■ cancelled');
        else if (msg.state === 'error' && appMode !== 'mirror') setPhase('error');
        break;
      case 'error':
        if (appMode === 'mirror' || appMode === 'picker') {
          setPhase('error', `⚠ ${truncate(msg.message, 24)}`);
        } else {
          response = `Error: ${msg.message}`;
          ui.setBody(render());
          setPhase('error');
        }
        break;
      default:
        break;
    }
  }

  const conn = new BridgeConn(config.bridgeUrl, config.token, {
    onOpen: () => setPhase('connecting', '… connecting'),
    onClose: () => setPhase('connecting', '○ offline — reconnecting'),
    onMessage: handleServer,
  });

  async function startRecording(): Promise<void> {
    if (!conn.isOpen) {
      setPhase('connecting', '○ offline — reconnecting');
      return;
    }
    recorder.start();
    setPhase('recording', '● REC — starting mic…');
    dbg('audioControl(true)…');
    try {
      await bridge.audioControl(true);
      dbg('audioControl(true) OK');
      setPhase('recording', mirrorHeader());
    } catch (err) {
      dbg(`audioControl ERR: ${err instanceof Error ? err.message : String(err)}`);
      recorder.stop();
      setPhase('error', '⚠ mic failed');
    }
  }

  async function stopRecordingAndSend(): Promise<void> {
    const b64 = recorder.stop();
    try {
      await bridge.audioControl(false);
    } catch {
      /* ignore stop failure */
    }
    if (!b64) {
      setPhase('idle', appMode === 'mirror' ? mirrorHeader() : '▶ nothing recorded');
      return;
    }
    conn.send({ type: 'audio', data: b64, sampleRate: config.sampleRate });
    setPhase('busy', '… transcribing');
  }

  function selectCurrent(): void {
    const t = targets[cursor];
    if (!t) return;
    conn.send({ type: 'selectTarget', id: t.id });
    appMode = 'mirror';
    followScreen = true;
    selectMode = false;
    setPhase('idle', `… opening ${t.label}`);
    ui.setBody(`Opening ${t.label}…`);
  }

  function backToPicker(): void {
    if (recorder.isActive) {
      recorder.stop();
      void bridge.audioControl(false).catch(() => {});
    }
    appMode = 'picker';
    selectMode = false;
    conn.send({ type: 'listTargets' });
    setPhase('idle', '… loading list');
  }

  function sendDemoCommand(): void {
    if (!conn.isOpen) return;
    transcript = config.demoText ?? '';
    response = '';
    ui.setBody(render());
    conn.send({ type: 'command', text: config.demoText ?? '' });
    setPhase('busy', '… thinking');
  }

  // Resolve the Yes/No confirmation (send if Yes, cancel if No) and return to
  // the mirror. Triggered by a single tap.
  function resolveConfirm(): void {
    const sent = confirmYes && pendingText.length > 0;
    if (sent) conn.send({ type: 'command', text: pendingText });
    pendingText = '';
    appMode = 'mirror';
    followScreen = true;
    // Restore the mirror immediately (no new screen arrives on cancel).
    ui.setBody(lastScreen, true);
    setPhase('idle', sent ? '… sent' : '✕ cancelled');
  }

  // Double-press: context-dependent primary action.
  let lastActionAt = 0;
  function onPrimaryAction(): void {
    const now = performance.now();
    if (now - lastActionAt < 700) {
      dbg('action ignored (debounce)');
      return;
    }
    lastActionAt = now;

    if (appMode === 'picker') {
      selectCurrent();
      return;
    }
    if (appMode === 'confirm') {
      resolveConfirm();
      return;
    }
    if (appMode === 'mirror') {
      if (selectMode) {
        exitSelect(); // double-press leaves select mode without choosing
        return;
      }
      // Double-press in the mirror goes back to the session list.
      backToPicker();
      return;
    }
    // headless / demo
    if (config.demoText) {
      sendDemoCommand();
      return;
    }
    if (recorder.isActive) void stopRecordingAndSend();
    else void startRecording();
  }

  // Debounce scrolling so one physical swipe = one page (the firmware often
  // fires the swipe event twice, which would skip a page of content).
  let lastScrollAt = 0;
  function scrollGuard(): boolean {
    const now = performance.now();
    if (now - lastScrollAt < 350) return false;
    lastScrollAt = now;
    return true;
  }

  function onSwipeUp(): void {
    if (appMode === 'picker') {
      moveCursor(-1);
    } else if (appMode === 'confirm') {
      toggleConfirm();
    } else if (appMode === 'mirror') {
      if (!scrollGuard()) return;
      if (selectMode) {
        sendKey('Up'); // navigate claude's prompt
        return;
      }
      followScreen = false; // stop auto-following so we can read past output
      ui.pageUp();
    } else {
      ui.pageUp();
    }
  }

  function onSwipeDown(): void {
    if (appMode === 'picker') moveCursor(1);
    else if (appMode === 'confirm') toggleConfirm();
    else if (appMode === 'mirror') {
      if (!scrollGuard()) return;
      if (selectMode) {
        sendKey('Down');
        return;
      }
      ui.pageDown();
      if (ui.atBottom()) followScreen = true; // resume following at the bottom
    } else {
      ui.pageDown();
    }
  }

  function sendKey(key: string): void {
    conn.send({ type: 'key', key });
  }
  function enterSelect(): void {
    selectMode = true;
    ui.setHeader(mirrorHeader());
  }
  function exitSelect(): void {
    selectMode = false;
    ui.setHeader(mirrorHeader());
  }

  // Single tap. On this hardware a tap is a bare sysEvent carrying eventSource:
  // 1 = right temple, 3 = left temple, 2 = ring. Debounced (taps can double-fire).
  let lastTapAt = 0;
  function onSingleTap(src: number | undefined): void {
    const now = performance.now();
    if (now - lastTapAt < 400) return;
    lastTapAt = now;

    const left = src === 3; // left temple (later: ring = 2 → treat as select too)

    if (appMode === 'mirror') {
      if (selectMode) {
        if (left) {
          sendKey('Enter'); // confirm the highlighted choice
          exitSelect();
        }
        // right tap while selecting: ignore (voice is off)
        return;
      }
      if (left) {
        enterSelect(); // left tap opens select mode for claude's prompt
        return;
      }
      // right tap = talk
      if (recorder.isActive) void stopRecordingAndSend();
      else void startRecording();
      return;
    }
    if (appMode === 'confirm') resolveConfirm(); // single tap decides Yes/No
  }

  bridge.onEvenHubEvent((event: EvenHubEvent) => {
    if (event.audioEvent?.audioPcm) {
      const u8 = asUint8(event.audioEvent.audioPcm);
      recorder.push(u8);
      return;
    }
    const rawEt =
      event.textEvent?.eventType ??
      event.sysEvent?.eventType ??
      event.listEvent?.eventType;
    const et = OsEventTypeList.fromJson(rawEt);
    const src =
      event.sysEvent?.eventSource ??
      (event.textEvent as { eventSource?: unknown })?.eventSource ??
      (event.listEvent as { eventSource?: unknown })?.eventSource;
    const srcNum = typeof src === 'number' ? src : undefined;
    dbg(`evt ${et === undefined ? 'tap?' : et} src=${String(src)} [${appMode}${selectMode ? '/sel' : ''}]`);
    // Bare sysEvent with no recognized type = a single tap on this hardware.
    if (et === undefined && event.sysEvent && !event.textEvent && !event.listEvent) {
      onSingleTap(srcNum);
      return;
    }
    switch (et) {
      case OsEventTypeList.CLICK_EVENT:
        onSingleTap(srcNum);
        break;
      case OsEventTypeList.DOUBLE_CLICK_EVENT:
        onPrimaryAction();
        break;
      case OsEventTypeList.SCROLL_TOP_EVENT:
        onSwipeUp();
        break;
      case OsEventTypeList.SCROLL_BOTTOM_EVENT:
        onSwipeDown();
        break;
      default:
        break; // undefined / system events ignored
    }
  });

  conn.connect();
}

function defaultHeader(p: Phase): string {
  switch (p) {
    case 'connecting':
      return '… connecting';
    case 'idle':
      return '▶ double-press to talk';
    case 'recording':
      return '● REC — double-press to send';
    case 'busy':
      return '… working';
    case 'error':
      return '⚠ error — tap to retry';
    default:
      return '';
  }
}

function asUint8(pcm: unknown): Uint8Array {
  if (pcm instanceof Uint8Array) return pcm;
  if (Array.isArray(pcm)) return new Uint8Array(pcm as number[]);
  if (pcm instanceof ArrayBuffer) return new Uint8Array(pcm);
  return new Uint8Array(0);
}

// Surface any failure on the phone screen instead of a blank page.
window.addEventListener('error', (e) => boot(`ERROR: ${e.message}`));
window.addEventListener('unhandledrejection', (e) =>
  boot(`REJECTED: ${String((e as PromiseRejectionEvent).reason)}`),
);

void main().catch((err: unknown) => {
  boot(`FATAL: ${err instanceof Error ? err.message : String(err)}`);
});
