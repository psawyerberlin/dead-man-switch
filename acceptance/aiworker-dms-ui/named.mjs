// Builds and tests app/ and checks the fixed UI test names (cwd = repository root).
import { spawnSync } from 'node:child_process';
const names = ['ui_renders_three_languages', 'i18n_no_hardcoded_strings', 'ui_cancel_two_clicks', 'ui_price_matches_quote', 'ui_mainnet_disabled',
  'ui_seal_checkbox_gates_next', 'ui_cost_panel_live', 'ui_guardians_clamped', 'ui_recipients_max_ten', 'ui_fee_below_capacity_refused',
  'ui_claim_before_create', 'ui_seal_reduced_motion', 'ui_owner_code_shown_once', 'ui_handover_guides_three_languages', 'ui_checkin_deeplink',
  'ui_away_until', 'ui_drill_bounds', 'ui_drill_hidden_on_mainnet', 'ui_contrast_tokens'];
const sh = (args, opts = {}) => spawnSync('npm', args, { cwd: 'app', encoding: 'utf8', env: { ...process.env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' }, ...opts });
if (sh(['ci', '--no-audit', '--no-fund'], { stdio: 'inherit' }).status !== 0) process.exit(1);
if (sh(['run', 'build'], { stdio: 'inherit' }).status !== 0) process.exit(1);
const r = sh(['test', '--silent']);
const out = (r.stdout || '') + (r.stderr || '');
let failed = r.status === 0 ? 0 : 1;
for (const n of names) {
  const passed = new RegExp(`(ok \\d+ - |✓ |√ |PASS[^\\n]*)${n}\\b`).test(out) && !new RegExp(`(not ok \\d+ - |✗ |× |FAIL[^\\n]*)${n}\\b`).test(out);
  console.log(`${passed ? 'ok  ' : 'FAIL'} ${n}`);
  if (!passed) failed++;
}
if (failed) console.log(out.split('\n').slice(-40).join('\n'));
process.exit(failed ? 1 : 0);
