// WebSocket client to the bridge. Handles (re)connection, the hello handshake,
// keepalive pings, and typed send/receive. Auto-reconnects with backoff —
// important because Android may drop the socket when the app is backgrounded.

import type { ClientMsg, ServerMsg } from './protocol.ts';

export interface ConnCallbacks {
  onMessage: (msg: ServerMsg) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

export class BridgeConn {
  private ws: WebSocket | null = null;
  private closedByUs = false;
  private reconnectDelay = 1000;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private url: string;
  private token: string;
  private cb: ConnCallbacks;

  constructor(url: string, token: string, cb: ConnCallbacks) {
    this.url = url;
    this.token = token;
    this.cb = cb;
  }

  connect(): void {
    this.closedByUs = false;
    this.open();
  }

  close(): void {
    this.closedByUs = true;
    this.stopPing();
    this.ws?.close();
    this.ws = null;
  }

  send(msg: ClientMsg): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private open(): void {
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectDelay = 1000;
      this.send({ type: 'hello', token: this.token });
      this.startPing();
      this.cb.onOpen?.();
    };

    ws.onmessage = (ev) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '') as ServerMsg;
      } catch {
        return;
      }
      this.cb.onMessage(msg);
    };

    ws.onclose = () => {
      this.stopPing();
      this.cb.onClose?.();
      if (!this.closedByUs) this.scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose fires next; reconnect is handled there.
      ws.close();
    };
  }

  private scheduleReconnect(): void {
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(delay * 2, 15000);
    setTimeout(() => {
      if (!this.closedByUs) this.open();
    }, delay);
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => this.send({ type: 'ping' }), 20000);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}
