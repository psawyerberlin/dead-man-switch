// JSON-lines logging with a redaction pass (SPEC.md §5.5): never an email address, a name, a link or a token.
// Names cannot be recognised by shape, so the code never logs them; everything else is caught here as a second line
// of defence: email-shaped strings, URLs, 43-character base64url tokens and 64-hex secrets become `[redacted]`.

export type Level = 'debug' | 'info' | 'warn' | 'error';
export type Sink = (line: string) => void;

const RULES: RegExp[] = [
  /[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g, // email addresses
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>\\]+/gi, // URLs (vault links, confirm/stop links, RPC URLs with credentials)
  /(?:0x)?[0-9a-fA-F]{64,}/g, // 32-byte secrets (and longer hex blobs)
  /\bdms1-[a-z]+-[0-9a-f]{8}-[A-Za-z0-9_-]{43}/g, // owner codes
  /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g, // confirm/stop tokens, owner codes (32 bytes base64url)
];

/** Replaces anything shaped like an email, a URL, a token or a 64-hex secret by `[redacted]`. */
export function redact(s: string): string {
  let out = s;
  for (const r of RULES) out = out.replace(r, '[redacted]');
  return out;
}

let sink: Sink = (line) => { process.stdout.write(line + '\n'); };
let minLevel: Level = (process.env.LOG_LEVEL as Level | undefined) ?? 'info';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Replaces the output (tests capture the log of the whole run). Returns the previous sink. */
export function setLogSink(s: Sink): Sink { const prev = sink; sink = s; return prev; }
export function setLogLevel(l: Level): void { minLevel = l; }

function describe(v: unknown): unknown {
  if (v instanceof Error) return { name: v.name, message: v.message };
  if (typeof v === 'bigint') return v.toString();
  return v;
}

export function log(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  if (ORDER[level] < ORDER[minLevel]) return;
  const entry: Record<string, unknown> = { time: new Date().toISOString(), level, msg };
  for (const [k, v] of Object.entries(fields)) entry[k] = describe(v);
  let line: string;
  try { line = JSON.stringify(entry, (_k, v: unknown) => describe(v)); } catch { line = JSON.stringify({ time: entry.time, level, msg }); }
  sink(redact(line));
}

export const logger = {
  debug: (msg: string, f?: Record<string, unknown>) => log('debug', msg, f),
  info: (msg: string, f?: Record<string, unknown>) => log('info', msg, f),
  warn: (msg: string, f?: Record<string, unknown>) => log('warn', msg, f),
  error: (msg: string, f?: Record<string, unknown>) => log('error', msg, f),
};
export type Logger = typeof logger;
