// The messenger API (SPEC.md §5.2) on node:http, no framework, mounted at /api/v1, JSON in and out.
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { descriptorHash } from '@crt/client';
import { sha256Hex } from './crypto.ts';
import { fromAcceptLanguage, t, type Language } from './i18n.ts';
import type { Chain, Clock, Mailer } from './interfaces.ts';
import { API_PREFIX, TOKEN_RE, canMail, confirmUrl, escapeHtml, newToken, renderConfirmation, stopUrl } from './mail.ts';
import { ValidationError, applyPatch, hex32, validateRecord, type MessengerRecord } from './record.ts';
import type { AddressRow, Store } from './store.ts';

export { API_PREFIX };
export const BODY_LIMIT = 256 * 1024;
/** A claim whose T is not live on chain this long after the claim expires. */
export const CLAIM_TTL_S = 2 * 3600;
export const LIMITS = {
  requests: { max: 30, windowS: 60 },
  claims: { max: 5, windowS: 3600 },
  confirmations: { max: 3, windowS: 7 * 24 * 3600 },
} as const;

export type ErrorCode = 'bad_request' | 'unauthorized' | 'conflict' | 'not_on_chain' | 'mismatch' | 'rate_limited' | 'too_large';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: ErrorCode, message: string, readonly headers: Record<string, string> = {}) { super(message); }
}

export interface NetworkStatus { tip: number | null; lag_s: number | null }

export interface ApiDeps {
  store: Store;
  chain: Chain;
  clock: Clock;
  mailer: Mailer;
  config: { networks: readonly string[]; appUrl: string; trustProxy: boolean };
  /** Chain status per network for /health (the watcher keeps it current). */
  status?: () => Record<string, NetworkStatus>;
}

/** In-memory sliding-window counters, keyed by IP and purpose. */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private sweeps = 0;

  /** Counts one hit; false when the limit of the window is already reached. */
  hit(key: string, max: number, windowS: number, now: number): boolean {
    if (++this.sweeps % 1000 === 0) this.sweep(now);
    const list = (this.hits.get(key) ?? []).filter((at) => at > now - windowS);
    if (list.length >= max) { this.hits.set(key, list); return false; }
    list.push(now);
    this.hits.set(key, list);
    return true;
  }

  private sweep(now: number): void {
    const longest = Math.max(...Object.values(LIMITS).map((l) => l.windowS));
    for (const [k, v] of this.hits) if (!v.some((at) => at > now - longest)) this.hits.delete(k);
  }
}

// ---------------------------------------------------------------------------------------------------------------

const SECURITY_HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(data), ...headers });
  res.end(data);
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, {
    ...SECURITY_HEADERS, 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(html),
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  });
  res.end(html);
}

/** A small server-rendered page in the address's language, no scripts. */
function page(lang: Language, title: string, paragraphs: string[], form?: { action: string; button: string }): string {
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`
    + `<meta name="robots" content="noindex"><title>${escapeHtml(title)}</title>`
    + '<style>body{font-family:system-ui,sans-serif;line-height:1.5;max-width:36em;margin:3em auto;padding:0 1em;color:#1d232b;background:#f7f5f0}'
    + 'h1{font-size:1.4em}button{font:inherit;padding:.6em 1.2em;border:1px solid #1d232b;border-radius:.4em;background:#fff;cursor:pointer}</style></head><body>'
    + `<h1>${escapeHtml(title)}</h1>` + paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('')
    + (form ? `<form method="post" action="${escapeHtml(form.action)}"><button type="submit">${escapeHtml(form.button)}</button></form>` : '')
    + '</body></html>';
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > BODY_LIMIT) { reject(new ApiError(413, 'too_large', `the body limit is ${BODY_LIMIT} bytes`)); return; }
    const chunks: Buffer[] = [];
    let size = 0, done = false;
    req.on('data', (c: Buffer) => {
      if (done) return;
      size += c.length;
      if (size > BODY_LIMIT) { done = true; reject(new ApiError(413, 'too_large', `the body limit is ${BODY_LIMIT} bytes`)); return; }
      chunks.push(c);
    });
    req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
    req.on('error', (e) => { if (!done) { done = true; reject(e); } });
  });
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const raw = await readBody(req);
  try { return JSON.parse(raw.toString('utf8')); } catch { throw new ApiError(400, 'bad_request', 'the body is not JSON'); }
}

const bad = (message: string): ApiError => new ApiError(400, 'bad_request', message);

/** The owner code `A`: `dms1-<network>-<T first 8 hex>-<A base64url>`, the bare base64url, or 32-byte hex. */
export function parseOwnerCode(s: string): Uint8Array | undefined {
  const m = /^dms1-[a-z]+-[0-9a-f]{8}-([A-Za-z0-9_-]{43})$/.exec(s);
  const b64 = m ? m[1]! : /^[A-Za-z0-9_-]{43}$/.test(s) ? s : undefined;
  if (b64) { const b = Buffer.from(b64, 'base64url'); return b.length === 32 ? new Uint8Array(b) : undefined; }
  if (/^(0x)?[0-9a-fA-F]{64}$/.test(s)) return new Uint8Array(Buffer.from(s.replace(/^0x/, ''), 'hex'));
  return undefined;
}

const plainHex = (h: string): string => h.replace(/^0x/, '').toLowerCase();

// ---------------------------------------------------------------------------------------------------------------

export interface Api {
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
  /** Deletes claims older than 2 h whose T is not live on chain (also done lazily by the routes). */
  expireClaims(): Promise<number>;
  readonly limiter: RateLimiter;
}

export function createApi(deps: ApiDeps): Api {
  const { store, chain, clock, mailer, config } = deps;
  const limiter = new RateLimiter();

  function clientIp(req: IncomingMessage): string {
    if (config.trustProxy) {
      // The reverse proxy appends the address it saw; the right-most entry is the one we can trust.
      const xff = req.headers['x-forwarded-for'];
      const last = (Array.isArray(xff) ? xff.join(',') : xff ?? '').split(',').map((s) => s.trim()).filter(Boolean).pop();
      if (last) return last;
    }
    return req.socket.remoteAddress ?? 'unknown';
  }

  function limit(ip: string, kind: keyof typeof LIMITS): void {
    const l = LIMITS[kind];
    if (!limiter.hit(`${kind}:${ip}`, l.max, l.windowS, clock.now())) {
      throw new ApiError(429, 'rate_limited', `at most ${l.max} ${kind} per ${l.windowS} s`, { 'retry-after': String(l.windowS) });
    }
  }

  function switchPath(networkSeg: string, TSeg: string): { network: string; T: string } {
    if (!config.networks.includes(networkSeg)) throw bad(`network must be one of ${config.networks.join(', ')}`);
    try { return { network: networkSeg, T: hex32(TSeg, 'T') }; } catch (e) { throw bad((e as Error).message); }
  }

  /** Bearer A with SHA-256(A) = the claim's admin_hash. */
  function authorize(req: IncomingMessage, network: string, T: string): void {
    const claim = store.getClaim(network, T);
    if (!claim) {
      if (store.getTombstone(network, T)) throw new ApiError(409, 'conflict', 'this switch has ended; its data was deleted');
      throw new ApiError(401, 'unauthorized', 'no claim for this switch');
    }
    const m = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.authorization ?? '');
    const A = m ? parseOwnerCode(m[1]!) : undefined;
    if (!A) throw new ApiError(401, 'unauthorized', 'Authorization: Bearer <owner code> is required', { 'www-authenticate': 'Bearer' });
    const got = Buffer.from(sha256Hex(A), 'hex'), want = Buffer.from(claim.adminHash, 'hex');
    if (want.length !== got.length || !timingSafeEqual(got, want)) throw new ApiError(401, 'unauthorized', 'wrong owner code', { 'www-authenticate': 'Bearer' });
  }

  async function chainState(network: string, T: string) {
    try { return await chain.switchState(network, T); } catch {
      throw new ApiError(502, 'not_on_chain', 'the chain could not be read; try again later');
    }
  }

  /** True when the claim is older than 2 h, has no record, and T is not live on chain: the claim is then deleted. */
  async function expireIfStale(network: string, T: string): Promise<boolean> {
    const claim = store.getClaim(network, T);
    if (!claim || store.getSwitchMeta(network, T) || clock.now() - claim.createdAt < CLAIM_TTL_S) return false;
    let state: string;
    try { state = (await chain.switchState(network, T)).state; } catch { return false; }
    if (state !== 'absent') return false;
    store.deleteClaim(network, T);
    return true;
  }

  async function expireClaims(): Promise<number> {
    let n = 0;
    for (const c of store.expiredClaims(clock.now() - CLAIM_TTL_S)) if (config.networks.includes(c.network) && await expireIfStale(c.network, c.T)) n++;
    return n;
  }

  /** Sends the owner's confirmation email and the "told now" emails still owed; recorded in the outbox first. */
  async function askConfirmations(rec: MessengerRecord, addresses: AddressRow[]): Promise<void> {
    const now = clock.now();
    for (const a of addresses) {
      if (a.confirmation !== 'none') continue;
      const r = a.role === 'recipient' ? rec.recipients.find((x) => x.index === a.idx) : undefined;
      if (a.role === 'recipient' && !(r?.tell_now || rec.drill)) continue;
      const who = a.role === 'owner' ? 'owner' : `recipient ${a.idx}`;
      if (!canMail(store, a)) { store.addEvent(rec.network, rec.T, now, 'confirm_skipped', `${who}: never`); continue; }
      if (store.confirmationsSince(a.email, now - LIMITS.confirmations.windowS) >= LIMITS.confirmations.max) {
        store.addEvent(rec.network, rec.T, now, 'confirm_skipped', `${who}: limit`); continue;
      }
      const kind = a.role === 'owner' ? 'owner_confirm' : 'told_now';
      // One per address and email: a changed email is asked again, an unchanged one never twice.
      const row = store.enqueue(rec.network, rec.T, kind, a.id, store.addressHmac(a.email).slice(0, 16), now);
      if (!row) continue;
      const confirm = newToken(), stop = newToken();
      store.setTokens(a.id, confirm, stop, now);
      store.markAttempt(row.id);
      const msg = renderConfirmation(kind, { lang: a.language, sender: rec.sender_label, T: rec.T, drill: rec.drill,
        confirmUrl: confirmUrl(config.appUrl, confirm), stopUrl: stopUrl(config.appUrl, stop) });
      try {
        await mailer.send({ to: a.email, ...msg });
        store.markDone(row.id, clock.now());
        store.touchLastMail(rec.network, rec.T, clock.now());
        store.addEvent(rec.network, rec.T, clock.now(), kind === 'owner_confirm' ? 'owner_asked' : 'recipient_asked', who);
      } catch {
        // Stays pending in the outbox; the watcher retries it once.
        store.addEvent(rec.network, rec.T, clock.now(), 'mail_failed', who);
      }
    }
  }

  function addressList(rec: MessengerRecord) {
    return [
      { role: 'owner' as const, idx: 0, email: rec.owner.email, name: rec.sender_label, language: rec.owner.language },
      ...rec.recipients.map((r) => ({ role: 'recipient' as const, idx: r.index, email: r.email, name: r.name, language: r.language })),
    ];
  }

  function summary(network: string, T: string) {
    const sw = store.getSwitch(network, T)!;
    return {
      network, T, drill: sw.drill, state: sw.state, created_at: sw.createdAt, updated_at: sw.updatedAt,
      record: sw.record,
      confirmations: store.listAddresses(network, T).map((a) => ({ role: a.role, index: a.idx, language: a.language, confirmation: a.confirmation })),
      events: store.listEvents(network, T).map((e) => ({ at: e.at, kind: e.kind, detail: e.detail })),
    };
  }

  // ---- routes

  async function postClaim(req: IncomingMessage, ip: string): Promise<[number, unknown]> {
    limit(ip, 'claims');
    const b = await readJson(req);
    if (typeof b !== 'object' || b === null || Array.isArray(b)) throw bad('the body must be {network, T, admin_hash}');
    const o = b as Record<string, unknown>;
    for (const k of Object.keys(o)) if (!['network', 'T', 'admin_hash'].includes(k)) throw bad(`unknown field ${k}`);
    if (typeof o.network !== 'string' || !config.networks.includes(o.network)) throw bad(`network must be one of ${config.networks.join(', ')}`);
    let T: string, adminHash: string;
    try { T = hex32(o.T, 'T'); adminHash = plainHex(hex32(o.admin_hash, 'admin_hash')); } catch (e) { throw bad((e as Error).message); }
    const network = o.network;
    if (store.getTombstone(network, T)) throw new ApiError(409, 'conflict', 'this switch has ended');
    if (store.getClaim(network, T) && !(await expireIfStale(network, T))) throw new ApiError(409, 'conflict', 'T is already claimed');
    if (!store.addClaim(network, T, adminHash, clock.now())) throw new ApiError(409, 'conflict', 'T is already claimed');
    return [201, { ok: true, network, T, expires_at: clock.now() + CLAIM_TTL_S }];
  }

  async function putSwitch(req: IncomingMessage, network: string, T: string): Promise<[number, unknown]> {
    authorize(req, network, T);
    const body = await readJson(req);
    let rec: MessengerRecord;
    try { rec = validateRecord(body, network, T); } catch (e) { if (e instanceof ValidationError) throw bad(e.message); throw e; }
    let localHash: string;
    try { localHash = descriptorHash(rec.descriptor as never).toLowerCase(); } catch { throw bad('the descriptor cannot be hashed'); }
    const s = await chainState(network, T);
    if (s.state === 'absent') {
      await expireIfStale(network, T);
      throw new ApiError(422, 'not_on_chain', 'this switch is not on chain');
    }
    if (s.state !== 'armed') throw new ApiError(422, 'not_on_chain', `the switch is ${s.state}, not armed`);
    if (!s.I || s.I.toLowerCase() !== rec.I) throw new ApiError(422, 'mismatch', 'I does not match the chain');
    if (!s.descriptorHash || s.descriptorHash.toLowerCase() !== localHash) throw new ApiError(422, 'mismatch', 'the descriptor hash does not match the Node Cells');

    const existed = !!store.getSwitchMeta(network, T);
    const now = clock.now();
    store.putSwitch(network, T, rec, rec.drill, now);
    const addresses = store.syncAddresses(network, T, addressList(rec));
    store.addEvent(network, T, now, existed ? 'record_replaced' : 'record_stored');
    await askConfirmations(rec, addresses);
    return [existed ? 200 : 201, summary(network, T)];
  }

  async function patchSwitch(req: IncomingMessage, network: string, T: string): Promise<[number, unknown]> {
    authorize(req, network, T);
    const body = await readJson(req);
    const sw = store.getSwitch(network, T);
    if (!sw) throw new ApiError(404, 'bad_request', 'no record for this switch yet');
    let rec: MessengerRecord;
    try { rec = applyPatch(sw.record as MessengerRecord, body); } catch (e) { if (e instanceof ValidationError) throw bad(e.message); throw e; }
    const now = clock.now();
    store.putSwitch(network, T, rec, rec.drill, now);
    const addresses = store.syncAddresses(network, T, addressList(rec));
    store.addEvent(network, T, now, 'record_changed');
    await askConfirmations(rec, addresses);
    return [200, summary(network, T)];
  }

  function tokenPage(req: IncomingMessage, res: ServerResponse, kind: 'confirm' | 'stop' | 'never', token: string): void {
    const now = clock.now();
    const a = TOKEN_RE.test(token) ? (kind === 'confirm' ? store.findByConfirmToken(token) : store.findByStopToken(token)) : undefined;
    if (!a) {
      const lang = fromAcceptLanguage(req.headers['accept-language']);
      sendHtml(res, 404, page(lang, t(lang, 'page_invalid_title'), [t(lang, 'page_invalid_text')]));
      return;
    }
    const lang = a.language as Language;
    const who = a.role === 'owner' ? 'owner' : `recipient ${a.idx}`;
    if (kind === 'confirm') {
      if (a.confirmation !== 'confirmed') { store.setConfirmation(a.id, 'confirmed'); store.addEvent(a.network, a.T, now, 'confirmed', who); }
      sendHtml(res, 200, page(lang, t(lang, 'page_confirm_title'), [t(lang, 'page_confirm_text')]));
    } else if (kind === 'stop') {
      if (a.confirmation !== 'stopped') { store.setConfirmation(a.id, 'stopped'); store.addEvent(a.network, a.T, now, 'stopped', who); }
      sendHtml(res, 200, page(lang, t(lang, 'page_stop_title'), [t(lang, 'page_stop_text'), t(lang, 'page_stop_question')],
        { action: `${API_PREFIX}/stop/${token}`, button: t(lang, 'page_stop_never_button') }));
    } else {
      store.addNever(a.email, now);
      if (a.confirmation !== 'stopped') store.setConfirmation(a.id, 'stopped');
      store.addEvent(a.network, a.T, now, 'never', who);
      sendHtml(res, 200, page(lang, t(lang, 'page_never_title'), [t(lang, 'page_never_text')]));
    }
  }

  function health(): [number, unknown] {
    const st = deps.status?.() ?? {};
    const networks: Record<string, NetworkStatus> = {};
    for (const n of config.networks) networks[n] = st[n] ?? { tip: null, lag_s: null };
    return [200, { ok: true, networks }];
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method ?? 'GET';
    if (url.pathname !== API_PREFIX && !url.pathname.startsWith(API_PREFIX + '/')) throw new ApiError(404, 'bad_request', 'unknown route');
    const seg = url.pathname.slice(API_PREFIX.length).split('/').filter(Boolean).map((s) => decodeURIComponent(s));
    const ip = clientIp(req);
    if (seg.length === 1 && seg[0] === 'health') {
      if (method !== 'GET') throw new ApiError(405, 'bad_request', 'method not allowed');
      const [st, body] = health(); sendJson(res, st, body); return;
    }
    limit(ip, 'requests');
    const notAllowed = () => new ApiError(405, 'bad_request', 'method not allowed');

    if (seg.length === 1 && seg[0] === 'claim') {
      if (method !== 'POST') throw notAllowed();
      const [st, body] = await postClaim(req, ip); sendJson(res, st, body); return;
    }
    if (seg.length === 3 && seg[0] === 'switch') {
      const { network, T } = switchPath(seg[1]!, seg[2]!);
      let out: [number, unknown];
      switch (method) {
        case 'PUT': out = await putSwitch(req, network, T); break;
        case 'PATCH': out = await patchSwitch(req, network, T); break;
        case 'GET': {
          authorize(req, network, T);
          if (!store.getSwitchMeta(network, T)) throw new ApiError(404, 'bad_request', 'no record for this switch yet');
          out = [200, summary(network, T)]; break;
        }
        case 'DELETE': {
          authorize(req, network, T);
          store.deleteSwitch(network, T, { state: 'deleted', now: clock.now() });
          out = [200, { ok: true, deleted: true }]; break;
        }
        default: throw notAllowed();
      }
      sendJson(res, out[0], out[1]); return;
    }
    if (seg.length === 2 && seg[0] === 'confirm') {
      if (method !== 'GET') throw notAllowed();
      tokenPage(req, res, 'confirm', seg[1]!); return;
    }
    if (seg.length === 2 && seg[0] === 'stop') {
      if (method === 'GET') { tokenPage(req, res, 'stop', seg[1]!); return; }
      if (method === 'POST') { await readBody(req); tokenPage(req, res, 'never', seg[1]!); return; }
      throw notAllowed();
    }
    throw new ApiError(404, 'bad_request', 'unknown route');
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      await route(req, res);
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(500, 'bad_request', 'internal error');
      if (res.headersSent) { res.destroy(); return; }
      const extra: Record<string, string> = { ...err.headers };
      if (err.code === 'too_large') extra.connection = 'close';
      sendJson(res, err.status, { error: err.code, message: err.message }, extra);
      if (err.code === 'too_large') req.resume();
    }
  }

  return { handle, expireClaims, limiter };
}

export function createServer(deps: ApiDeps): Server & { api: Api } {
  const api = createApi(deps);
  const server = createHttpServer((req, res) => { void api.handle(req, res); });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  return Object.assign(server, { api });
}
