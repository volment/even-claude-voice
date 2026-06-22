// Tiny timestamped logger. Keeps stdout readable without pulling in a dep.

type Level = 'info' | 'warn' | 'error' | 'debug';

const COLORS: Record<Level, string> = {
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
  debug: '\x1b[90m',
};
const RESET = '\x1b[0m';

function emit(level: Level, args: unknown[]): void {
  const ts = new Date().toISOString().slice(11, 19);
  const tag = `${COLORS[level]}[${level}]${RESET}`;
  const line = `${ts} ${tag}`;
  if (level === 'error') console.error(line, ...args);
  else console.log(line, ...args);
}

export const log = {
  info: (...args: unknown[]) => emit('info', args),
  warn: (...args: unknown[]) => emit('warn', args),
  error: (...args: unknown[]) => emit('error', args),
  debug: (...args: unknown[]) => {
    if (process.env.BRIDGE_DEBUG) emit('debug', args);
  },
};
