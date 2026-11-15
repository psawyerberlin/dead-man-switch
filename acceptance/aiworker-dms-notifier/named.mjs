// Runs `npm test` in notifier/ and checks the fixed test names of aiworker/02-dms-notifier.md (cwd = repository root).
import { spawnSync } from 'node:child_process';
const names = ['store_encrypts_at_rest', 'crypto_matches_vectors', 'i18n_same_keys_in_all_languages', 'env_rejects_missing_key',
  'api_claim_then_put', 'api_rejects_wrong_admin_token', 'api_rejects_duplicate_claim', 'api_claim_expires', 'api_put_checks_chain',
  'api_rejects_eleven_recipients', 'api_rate_limits', 'api_get_hides_other_switches', 'confirm_and_stop_tokens', 'never_list_blocks_future_mail',
  'watcher_sends_reminders_once', 'watcher_reminders_follow_checkin', 'watcher_drill_reminders', 'watcher_grace_alarms',
  'watcher_release_decrypts_link_and_mails', 'watcher_release_unconfirmed_one_mail', 'watcher_drill_skips_unconfirmed', 'watcher_cancel_deletes_record',
  'watcher_retention_and_tombstone', 'mail_three_languages', 'logs_redact_personal_data'];
const install = spawnSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: 'notifier', stdio: 'inherit' });
if (install.status !== 0) { console.log('npm ci failed'); process.exit(1); }
const r = spawnSync('npm', ['test', '--silent'], { cwd: 'notifier', encoding: 'utf8', env: { ...process.env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' } });
const out = (r.stdout || '') + (r.stderr || '');
let failed = r.status === 0 ? 0 : 1;
if (r.status !== 0) console.log(out.split('\n').slice(-40).join('\n'));
for (const n of names) {
  const passed = new RegExp(`(ok \\d+ - |✓ |√ |PASS[^\\n]*)${n}\\b`).test(out) && !new RegExp(`(not ok \\d+ - |✗ |× |FAIL[^\\n]*)${n}\\b`).test(out);
  console.log(`${passed ? 'ok  ' : 'FAIL'} ${n}`);
  if (!passed) failed++;
}
process.exit(failed ? 1 : 0);
