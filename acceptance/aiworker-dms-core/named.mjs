// Runs `npm test` in app/ and checks the fixed test names of aiworker/01-dms-core.md (cwd = repository root).
import { spawnSync } from 'node:child_process';
const names = ['bundle_roundtrip', 'bundle_wrong_identity_fails', 'bundle_size_limit', 'vault_deterministic', 'vault_self_contained',
  'vault_roundtrip_parse', 'vault_filename', 'ics_has_two_alarms', 'i18n_same_keys_in_all_languages', 'i18n_detect_order', 'i18n_plural_forms',
  'quote_matches_crt_defaults', 'opener_registers_hook', 'opener_renders_letter_in_three_languages', 'opener_markdown_is_sanitised', 'opener_file_download_links'];
const install = spawnSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: 'app', stdio: 'inherit' });
if (install.status !== 0) { console.log('npm ci failed'); process.exit(1); }
const r = spawnSync('npm', ['test', '--silent'], { cwd: 'app', encoding: 'utf8', env: { ...process.env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' } });
const out = (r.stdout || '') + (r.stderr || '');
let failed = r.status === 0 ? 0 : 1;
if (r.status !== 0) console.log(out.split('\n').slice(-40).join('\n'));
for (const n of names) {
  const passed = new RegExp(`(ok \\d+ - |✓ |√ |PASS[^\\n]*)${n}\\b`).test(out) && !new RegExp(`(not ok \\d+ - |✗ |× |FAIL[^\\n]*)${n}\\b`).test(out);
  console.log(`${passed ? 'ok  ' : 'FAIL'} ${n}`);
  if (!passed) failed++;
}
process.exit(failed ? 1 : 0);
