import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RECORD, makeRun, readJson, run, writeBatch } from './helpers.mjs';

const RULES = [
  { ruleId: 1, name: 'Docstrings everywhere', category: 'Maintainability', severity: 'recommendation', content: 'docs', guard_hits: [] },
  { ruleId: 2, name: 'Security naming', category: 'Security', severity: 'warning', content: 'names', guard_hits: [] },
  { ruleId: 3, name: 'Payment naming', category: 'Quality', severity: 'warning', content: 'payment names', guard_hits: ['payment'] },
  { ruleId: 4, name: 'Upper-case severity', category: 'Quality', severity: 'WARNING', content: 'x', guard_hits: [] },
  { ruleId: 5, name: 'Odd severity', category: 'Quality', severity: 'critical', content: 'x', guard_hits: [] },
  { ruleId: 6, name: 'Layering at error', category: 'Architecture', severity: 'error', content: 'x', guard_hits: [] },
  { ruleId: 7, name: 'Security already low', category: 'Security', severity: 'recommendation', content: 'x', guard_hits: [] },
  { ruleId: 10, name: 'Ten', category: 'Quality', severity: 'warning', content: 'x', guard_hits: [] },
  { ruleId: 100, name: 'Hundred', category: 'Quality', severity: 'warning', content: 'x', guard_hits: [] },
  { ruleId: 9, name: 'Nine', category: 'Quality', severity: 'warning', content: 'x', guard_hits: [] },
];
const TAGS = { 1: 'documentation', 2: 'naming', 3: 'naming', 4: 'api-contract', 5: 'api-contract', 6: 'architecture', 7: 'naming', 9: 'logging', 10: 'logging', 100: 'logging' };

function setup() {
  const ctx = makeRun('version: 1\nseverity_overrides: {documentation: warning}\n');
  writeBatch(ctx.runDir, 1, RULES);
  writeBatch(ctx.runDir, 2, [{ ruleId: 200, name: 'B2', category: 'Quality', severity: 'warning', content: 'x', guard_hits: [] }]);
  writeFileSync(join(ctx.runDir, 'export.json'), JSON.stringify({ run_id: 't', totalCount: 11, rules: [...RULES, { ruleId: 200, severity: 'warning' }].map((r) => ({ ruleId: r.ruleId, severity: r.severity })) }));
  return ctx;
}

test('rows derive proposed severity, vetoes, unknown severity, and numeric ordering', () => {
  const { runDir } = setup();
  const res = run(RECORD, ['--run', runDir, '--batch', '1', '--tags', JSON.stringify(TAGS)]);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.json.status, 'recorded');
  const rows = readJson(join(runDir, 'classification.json'));
  const by = Object.fromEntries(rows.map((r) => [r.rule_id, r]));
  assert.deepEqual(Object.keys(by[1]), ['rule_id', 'name', 'category', 'current', 'tag', 'rubric_proposed', 'proposed', 'direction', 'guard_hits', 'needs_decision', 'batch']);
  // override {documentation: warning} propagates
  assert.equal(by[1].proposed, 'warning'); assert.equal(by[1].direction, 'increase'); assert.equal(by[1].needs_decision, false);
  // rubric_proposed is the snapshot severity for the tag, before any veto; proposed is unchanged
  assert.equal(by[1].rubric_proposed, 'warning');
  assert.equal(by[3].rubric_proposed, 'recommendation'); // naming default, vetoed back to warning
  assert.equal(by[5].rubric_proposed, 'warning'); // api-contract default, unknown current severity
  assert.equal(by[6].rubric_proposed, 'warning');
  for (const row of rows) assert.ok(['error', 'warning', 'recommendation'].includes(row.rubric_proposed));
  // category prior veto: Security + naming at warning
  assert.equal(by[2].needs_decision, true); assert.equal(by[2].proposed, 'warning'); assert.equal(by[2].direction, 'none');
  // guard veto
  assert.equal(by[3].needs_decision, true); assert.equal(by[3].proposed, 'warning'); assert.deepEqual(by[3].guard_hits, ['payment']);
  // severity lower-cased before ranking
  assert.equal(by[4].current, 'warning'); assert.equal(by[4].proposed, 'warning'); assert.equal(by[4].direction, 'none'); assert.equal(by[4].needs_decision, false);
  // unknown current severity → needs_decision, never refuses the batch
  assert.equal(by[5].current, 'critical'); assert.equal(by[5].needs_decision, true); assert.equal(by[5].proposed, 'critical'); assert.equal(by[5].direction, 'none');
  // plain decrease
  assert.equal(by[6].proposed, 'warning'); assert.equal(by[6].direction, 'decrease'); assert.equal(by[6].tag, 'architecture');
  // Security rule already at recommendation: unchanged, no decision needed (proposal is a diff)
  assert.equal(by[7].direction, 'none'); assert.equal(by[7].needs_decision, false);
  // numeric ordering of ids
  assert.deepEqual(rows.map((r) => r.rule_id), [1, 2, 3, 4, 5, 6, 7, 9, 10, 100]);
  assert.ok(!rows.some((r) => r.needs_decision && r.direction === 'decrease'));
});

test('--status emits disjoint counts plus current_counts from export.json', () => {
  const { runDir } = setup();
  run(RECORD, ['--run', runDir, '--batch', '1', '--tags', JSON.stringify(TAGS)]);
  const res = run(RECORD, ['--run', runDir, '--status']);
  assert.equal(res.status, 0, res.stderr);
  const s = res.json;
  assert.equal(s.rows, 10);
  assert.equal(s.decrease, 1);
  assert.equal(s.increase, 1);
  assert.equal(s.unchanged, 5);
  assert.equal(s.needs_decision, 3);
  assert.equal(s.decrease + s.increase + s.unchanged + s.needs_decision, s.rows);
  assert.equal(s.none, undefined);
  assert.deepEqual(s.batches_done, [1]);
  assert.deepEqual(s.batches_remaining, [2]);
  assert.equal(s.total_rules, 11);
  assert.deepEqual(s.current_counts, { error: 1, warning: 7, recommendation: 2, other: 1 });
});

test('a re-run skips a recorded batch; --replace re-records it', () => {
  const { runDir } = setup();
  assert.equal(run(RECORD, ['--run', runDir, '--batch', '1', '--tags', JSON.stringify(TAGS)]).status, 0);
  const skip = run(RECORD, ['--run', runDir, '--batch', '1', '--tags', '{}']);
  assert.equal(skip.status, 0);
  assert.equal(skip.json.status, 'already_recorded');
  assert.equal(readJson(join(runDir, 'classification.json')).length, 10);
  const rep = run(RECORD, ['--run', runDir, '--batch', '1', '--replace', '--tags', JSON.stringify({ ...TAGS, 6: 'api-contract' })]);
  assert.equal(rep.status, 0, rep.stderr);
  assert.equal(rep.json.status, 'replaced');
  assert.equal(rep.json.replaced_rows, 10);
  const rows = readJson(join(runDir, 'classification.json'));
  assert.equal(rows.length, 10);
  assert.equal(rows.find((r) => r.rule_id === 6).tag, 'api-contract');
});

test('incomplete or invalid tag maps are refused and nothing is written', () => {
  const { runDir } = setup();
  const missing = run(RECORD, ['--run', runDir, '--batch', '1', '--tags', JSON.stringify({ ...TAGS, 9: undefined })]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /ruleId 9 \("Nine"\) has no tag/);
  const bad = run(RECORD, ['--run', runDir, '--batch', '1', '--tags', JSON.stringify({ ...TAGS, 1: 'docs', 999: 'naming' })]);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /unknown tag "docs"/);
  assert.match(bad.stderr, /ruleId 999 is not in batch 1/);
  const proto = run(RECORD, ['--run', runDir, '--batch', '1', '--tags', JSON.stringify({ ...TAGS, 1: 'constructor' })]);
  assert.equal(proto.status, 2);
  assert.match(proto.stderr, /unknown tag "constructor"/);
  assert.ok(!existsSync(join(runDir, 'classification.json')));
  const nobatch = run(RECORD, ['--run', runDir, '--batch', '9', '--tags', '{}']);
  assert.equal(nobatch.status, 2);
  assert.match(nobatch.stderr, /batch 9 does not exist/);
});

test('a corrupt batch file is reported with exit 2', () => {
  const { runDir } = setup();
  writeFileSync(join(runDir, 'batches', 'batch-002.json'), '{"rules": "nope"}');
  const res = run(RECORD, ['--run', runDir, '--batch', '2', '--tags', '{"200":"logging"}']);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /has no rules array/);
  writeFileSync(join(runDir, 'batches', 'batch-002.json'), 'not json');
  const res2 = run(RECORD, ['--run', runDir, '--batch', '2', '--tags', '{"200":"logging"}']);
  assert.equal(res2.status, 2);
  assert.match(res2.stderr, /batch file .* is not valid JSON/);
});
