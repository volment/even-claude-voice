#!/usr/bin/env -S npx tsx
// Entry point: load config, print connection info, start the WebSocket server.

import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { networkInterfaces } from 'node:os';
import { loadConfig } from './config.ts';
import { startServer } from './server.ts';
import { startStaticServer } from './static.ts';
import { startInboxWatcher } from './watch.ts';
import { log } from './log.ts';

// Load a .env file if present (env vars are the primary config source).
function loadDotenv(): void {
  for (const file of ['.env', '.env.local']) {
    const p = resolve(process.cwd(), file);
    if (existsSync(p)) {
      try {
        process.loadEnvFile(p);
        log.info(`loaded ${file}`);
      } catch (err) {
        log.warn(`could not load ${file}: ${(err as Error).message}`);
      }
    }
  }
}

function lanAddresses(): string[] {
  const out: string[] = [];
  for (const iface of Object.values(networkInterfaces())) {
    for (const addr of iface ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) out.push(addr.address);
    }
  }
  return out;
}

function main(): void {
  loadDotenv();

  // config.json is optional; env vars alone are enough to run.
  const argPath = process.argv[2] ?? process.env.BRIDGE_CONFIG;
  const configPath = argPath ? resolve(argPath) : resolve('config.json');
  const config = loadConfig(existsSync(configPath) ? configPath : undefined);

  if (process.env.ANTHROPIC_API_KEY) {
    log.warn(
      'ANTHROPIC_API_KEY is set in this shell — the bridge strips it per-run so Claude uses your subscription, but consider unsetting it to be safe.',
    );
  }

  startServer(config);

  if (config.zkRoot) {
    const distDir = join(config.zkRoot, '.system', 'glasses', 'dist');
    startStaticServer(distDir, 5174, config.host);
    startInboxWatcher(config.zkRoot);
  }

  log.info(`bridge listening on ${config.host}:${config.port}`);
  log.info(`project dir (cwd for claude): ${config.cwd}`);
  log.info(`permission mode: ${config.permissionMode}`);
  log.info(`whisper model: ${config.whisper.model}`);
  log.info(`token: ${config.token}`);
  const addrs = lanAddresses();
  if (addrs.length) {
    log.info('glasses app — set the host to one of:');
    for (const a of addrs) log.info(`   ws://${a}:${config.port}`);
  }
}

main();
