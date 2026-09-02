// fake-qodo.mjs — stand-in for the qodo launcher, driven by environment variables.
//   FAKE_TOTAL      total active rules (default 230)
//   FAKE_MODE       ok | truncate_above:<size> | truncate_at:<page>:<size> | ratelimit:<n> |
//                   ratelimit_stderr:<n> | short | null | noisy | drift | stuck
//   FAKE_STATE      file used to count rate-limited calls
//   FAKE_LOG        file that receives one JSON line per call ({page,size})
//   FAKE_READ_ARGS  expected leading arguments (default "read rules list")
//
// The `rules update` branch (any call carrying --rule-id) is driven separately:
//   FAKE_UPDATE_MODE  ok | fail:<id>:<code> | ratelimit:<id>:<n> | ratelimit_stderr:<id>:<n> |
//                     upstream:<id>:<n> | auth_at:<id> | forbidden_at:<id> | mismatch:<id> |
//                     garbage:<id> | nosev_at:<id> | nested_at:<id>:<key> | exit1_at:<id> |
//                     hang_at:<id>:<ms>
//                     (ids not named behave "ok")
//   FAKE_UPDATE_LOG   file that receives one JSON line per call with the full argv
//   FAKE_UPDATE_ARGS  expected leading arguments (default "rules update")
//   FAKE_STATE        JSON file counting per-id failures for the counted modes
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const val = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const page = Number(val('--page'));
const size = Number(val('--page-size'));
const mode = process.env.FAKE_MODE || 'ok';
const total = Number(process.env.FAKE_TOTAL ?? 230);
const expectedRead = (process.env.FAKE_READ_ARGS || 'read rules list').split(' ');

if (process.env.FAKE_LOG) appendFileSync(process.env.FAKE_LOG, `${JSON.stringify({ page, size })}\n`);
process.stderr.write('  trace 0123abcd\n');

const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const err = (code, message, tool = 'rules-list') => { out({ error: { code, message, tool } }); process.exit(1); };

// ---------------------------------------------------------------------------------------
// rules update — the only write this skill makes. Recognised by --rule-id, so a changed command
// path (--update-args) still lands here.

if (args.includes('--rule-id')) {
  const ruleId = val('--rule-id');
  const severity = val('--severity');
  const key = val('--idempotency-key');
  const expectedUpdate = (process.env.FAKE_UPDATE_ARGS || 'rules update').split(' ');
  const uerr = (code, message) => err(code, message, 'rules-update');
  if (process.env.FAKE_UPDATE_LOG) appendFileSync(process.env.FAKE_UPDATE_LOG, `${JSON.stringify({ rule_id: ruleId, severity, key, argv: args })}\n`);
  if (args.slice(0, expectedUpdate.length).join(' ') !== expectedUpdate.join(' ')) uerr('unknown_tool', `unknown command: ${args.slice(0, 2).join(' ')}`);
  if (!ruleId || !severity) uerr('invalid_arguments', '--rule-id and --severity are required');
  if (!args.includes('--json')) uerr('invalid_arguments', '--json is required');
  if (!key) uerr('invalid_arguments', '--idempotency-key is required');

  const umode = process.env.FAKE_UPDATE_MODE || 'ok';
  const [kind, target, extra] = umode.split(':');
  const hit = target === ruleId;

  // Counted modes fail the named rule `extra` times, then succeed — one counter per rule id.
  const bump = () => {
    const st = process.env.FAKE_STATE;
    let counts = {};
    if (st && existsSync(st)) { try { counts = JSON.parse(readFileSync(st, 'utf8')); } catch { counts = {}; } }
    const c = Number(counts[ruleId] ?? 0);
    if (c >= Number(extra)) return false;
    counts[ruleId] = c + 1;
    if (st) writeFileSync(st, JSON.stringify(counts));
    return true;
  };

  if (hit && kind === 'fail') uerr(extra, `rule ${ruleId} rejected: ${extra}`);
  if (hit && kind === 'auth_at') uerr('not_logged_in', 'Not logged in — run qodo login');
  // A permission denial the server states in prose only: the code says nothing, the message does.
  if (hit && kind === 'forbidden_at') uerr('unexpected_error', `Permission denied: admin permission is required to update rule ${ruleId}`);
  if (hit && kind === 'garbage') { process.stdout.write(`<html>rule ${ruleId} gateway error</html>\n`); process.exit(1); }
  if (hit && kind === 'ratelimit' && bump()) uerr('MT-RATE-LIMITED', 'slow down');
  // The rate limit reported only on stderr, with nothing on stdout — the shape export-rules saw.
  if (hit && kind === 'ratelimit_stderr' && bump()) { process.stderr.write('MT-RATE-LIMITED: slow down\n'); process.exit(1); }
  if (hit && kind === 'upstream' && bump()) uerr('MT-UPSTREAM-DOWN', 'upstream unavailable');
  // Blocks past the caller's timeout without printing anything.
  if (hit && kind === 'hang_at') {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(extra) > 0 ? Number(extra) : 3000);
    process.exit(0);
  }

  const applied = hit && kind === 'mismatch' ? (severity === 'error' ? 'warning' : 'error') : severity;
  const envelope = { ruleId: Number(ruleId), name: `Rule ${ruleId}`, state: 'active', category: 'Quality' };
  let body;
  if (hit && kind === 'nosev_at') {
    // A success object that never names the severity, so the write cannot be corroborated.
    body = envelope;
  } else if (hit && kind === 'nested_at') {
    // The severity under a wrapper key (`rule`, `result` or `data`) instead of at the top level.
    body = { ok: true, [extra || 'rule']: { ...envelope, severity: applied } };
  } else {
    body = { ...envelope, severity: applied };
  }
  out(body);
  // exit1_at: the success object on stdout but a non-zero status — the outcome is unknown.
  process.exit(hit && kind === 'exit1_at' ? 1 : 0);
}

if (args.slice(0, expectedRead.length).join(' ') !== expectedRead.join(' ')) err('unknown_command', `unknown command: ${args.slice(0, 3).join(' ')}`);
if (!Number.isInteger(page) || !Number.isInteger(size)) err('invalid_arguments', 'page/page-size missing');
if (size > 100) err('MT-VALIDATION', "argument 'page_size' violates the tool's schema constraint maximum=100");

function countedFailure(prefix, emit) {
  if (!mode.startsWith(prefix)) return;
  const n = Number(mode.slice(prefix.length));
  const st = process.env.FAKE_STATE;
  const c = st && existsSync(st) ? Number(readFileSync(st, 'utf8')) : 0;
  if (c < n) { if (st) writeFileSync(st, String(c + 1)); emit(); }
}
countedFailure('ratelimit:', () => err('MT-RATE-LIMITED', 'slow down'));
countedFailure('ratelimit_stderr:', () => { process.stderr.write('MT-RATE-LIMITED: slow down\n'); process.exit(1); });

const truncated = () => { out({ qar_operation_result_truncated: true, byte_size: 290828, max_bytes: 262144 }); process.exit(0); };
if (mode.startsWith('truncate_above:') && size > Number(mode.split(':')[1])) truncated();
if (mode.startsWith('truncate_at:')) { const [, p, s] = mode.split(':'); if (page === Number(p) && size === Number(s)) truncated(); }
if (mode === 'null') { process.stdout.write('null\n'); process.exit(0); }

const CATS = ['Security', 'Quality', 'Correctness', 'Maintainability', 'Architecture'];
const mk = (i) => ({
  ruleId: i,
  name: `Rule ${i}${i % 7 === 0 ? ' requires Authentication' : ''}`,
  category: CATS[i % 5],
  severity: i % 3 === 0 ? 'error' : i % 17 === 0 ? 'recommendation' : 'warning',
  content: `Check ${i}.${i % 11 === 0 ? ' Never leave deleted rows behind.' : ''}${i % 13 === 0 ? ' Handles personal  data.' : ''}${i % 19 === 0 ? ' Written by the author.' : ''}`,
  goodExamples: 'x', badExamples: 'y', url: null,
});

const effectivePage = mode === 'stuck' ? 1 : page;
const start = (effectivePage - 1) * size + 1;
const end = Math.min(total, start + size - 1);
let rules = [];
for (let i = start; i <= end; i++) rules.push(mk(i));
if (mode === 'short' && page === 2) rules = rules.slice(0, 5);
const payload = { page, totalCount: mode === 'drift' && page === 2 ? total + 1 : total, rules };
if (mode === 'noisy') {
  // Real CLIs put notices on stderr; stdout may still carry stray lines around the JSON.
  process.stderr.write('QODO_NOTICE {"code":"qodo_skill_update_available","steps":[]}\n');
  process.stdout.write(`Updating catalog cache...\n${JSON.stringify(payload)}\n  trace ffff\n`);
} else out(payload);
