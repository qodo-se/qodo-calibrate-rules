// fake-qodo.mjs — stand-in for the qodo launcher, driven by environment variables.
//   FAKE_TOTAL      total active rules (default 230)
//   FAKE_MODE       ok | truncate_above:<size> | truncate_at:<page>:<size> | ratelimit:<n> |
//                   ratelimit_stderr:<n> | short | null | noisy | drift | stuck
//   FAKE_STATE      file used to count rate-limited calls
//   FAKE_LOG        file that receives one JSON line per call ({page,size})
//   FAKE_READ_ARGS  expected leading arguments (default "read rules list")
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
const err = (code, message) => { out({ error: { code, message, tool: 'rules-list' } }); process.exit(1); };

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
