// App configuration: bridge URL + token.
//
// The glasses have no keyboard, so config is resolved in this order:
//   1. URL query params  ?bridge=ws://IP:PORT&token=XXX   (set via the dev QR URL)
//   2. persisted localStorage (host-backed, survives Android suspension)
//   3. baked DEFAULTS below (edit for your own machine)
//
// Whichever query params are present are persisted, so you only pass them once.

import type { EvenAppBridge } from '@evenrealities/even_hub_sdk';

export interface AppConfig {
  bridgeUrl: string;
  token: string;
  sampleRate: number;
  // Dev/simulator only: when set, a press sends this text instead of recording
  // (the simulator has no microphone). Pass via ?demo=...
  demoText?: string;
}

// Defaults baked at build time from glasses/.env (VITE_*). Used by a packaged
// (.ehpk) install where there are no URL query params. For dev, query params
// (?bridge=...&token=...) still override these.
const DEFAULTS: AppConfig = {
  bridgeUrl: (import.meta.env.VITE_BRIDGE_URL as string | undefined) ?? '',
  token: (import.meta.env.VITE_BRIDGE_TOKEN as string | undefined) ?? '',
  sampleRate: 16000,
};

const KEY_URL = 'bridgeUrl';
const KEY_TOKEN = 'bridgeToken';

export async function loadConfig(bridge: EvenAppBridge): Promise<AppConfig> {
  const params = new URLSearchParams(window.location.search);
  const qpUrl = params.get('bridge') ?? undefined;
  const qpToken = params.get('token') ?? undefined;

  if (qpUrl) await safeSet(bridge, KEY_URL, qpUrl);
  if (qpToken) await safeSet(bridge, KEY_TOKEN, qpToken);

  const bridgeUrl =
    qpUrl ?? (await safeGet(bridge, KEY_URL)) ?? DEFAULTS.bridgeUrl;
  const token =
    qpToken ?? (await safeGet(bridge, KEY_TOKEN)) ?? DEFAULTS.token;
  const demoText = params.get('demo') ?? undefined;

  return { bridgeUrl, token, sampleRate: DEFAULTS.sampleRate, demoText };
}

async function safeGet(
  bridge: EvenAppBridge,
  key: string,
): Promise<string | undefined> {
  try {
    const v = await bridge.getLocalStorage(key);
    return v || undefined;
  } catch {
    return undefined;
  }
}

async function safeSet(
  bridge: EvenAppBridge,
  key: string,
  value: string,
): Promise<void> {
  try {
    await bridge.setLocalStorage(key, value);
  } catch {
    /* non-fatal: fall back to in-memory for this run */
  }
}
