// Entry point: configuration, store, API on node:http, and the watcher every 5 minutes per network.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from './api.ts';
import { CrtChain } from './chain.ts';
import { EnvError, loadConfig } from './env.ts';
import { systemClock } from './interfaces.ts';
import { logger } from './log.ts';
import { SmtpMailer } from './mail.ts';
import { Store } from './store.ts';
import { TICK_S, createWatcher } from './watcher.ts';

async function main(): Promise<void> {
  let config;
  try { config = loadConfig(); } catch (e) {
    if (e instanceof EnvError) { logger.error('configuration refused', { error: e }); process.exit(2); }
    throw e;
  }
  mkdirSync(config.dataDir, { recursive: true });
  const store = new Store(join(config.dataDir, 'notifier.db'), config.dataKey);
  const chain = await CrtChain.create(config.rpc, config.deploymentsDir);
  const mailer = new SmtpMailer(config.smtp, config.mailFrom);
  const clock = systemClock;
  const watcher = createWatcher({ store, chain, clock, mailer, config: { networks: config.networks, appUrl: config.appUrl } });
  const server = createServer({ store, chain, clock, mailer, status: watcher.status,
    config: { networks: config.networks, appUrl: config.appUrl, trustProxy: config.trustProxy } });

  let running = false;
  const runAll = async () => {
    if (running) return; // never two ticks at once
    running = true;
    try {
      await server.api.expireClaims();
      for (const n of config.networks) await watcher.tick(n);
    } catch (e) {
      logger.error('tick failed', { error: e });
    } finally { running = false; }
  };
  const timer = setInterval(() => { void runAll(); }, TICK_S * 1000);
  server.listen(config.port, () => logger.info('listening', { port: config.port, networks: config.networks }));
  void runAll();

  const stop = (signal: string) => {
    logger.info('stopping', { signal });
    clearInterval(timer);
    server.close(() => { store.close(); process.exit(0); });
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}

main().catch((e: unknown) => { logger.error('fatal', { error: e }); process.exit(1); });
