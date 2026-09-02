import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { contentHash } from '../lib/ledger-lib.mjs';
import { parseFrontmatter, parseProposal, parseRow, renderRow, validateSummary } from '../lib/proposal-lib.mjs';
import {
  APPROVE, CALIB_DECISIONS, CALIB_PRECHECKED, CALIB_RULES, CALIB_TAGS, CALIB_UNCHANGED,
  PROPOSAL, makeCalibrated, readJson, readText, run, summariesFor,
} from './helpers.mjs';

const RENDERED = [...CALIB_PRECHECKED, ...CALIB_DECISIONS];

function setup(opts = {}) {
  return makeCalibrated({ rules: CALIB_RULES, tags: CALIB_TAGS, ...opts });
}

function summarize(ctx, ids = RENDERED) {
  const res = run(PROPOSAL, ['--run', ctx.runDir, '--record-summaries', JSON.stringify(summariesFor(ids))], { env: ctx.env });
  assert.equal(res.status, 0, res.stderr);
  return res;
}

function render(ctx, extra = []) {
  return run(PROPOSAL, ['--run', ctx.runDir, '--render', '--workspace-id', 'ws-1', ...extra], { env: ctx.env });
}

function seedLedger(ctx, entries) {
  writeFileSync(ctx.ledger, `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`);
}

function entry(ruleId, decision, severity, { content = null, run_id = '20251201-000000' } = {}) {
  const rule = CALIB_RULES.find((r) => r.ruleId === ruleId);
  return {
    rule_id: ruleId,
    decision,
    severity_at_decision: severity,
    content_hash: contentHash(content ?? rule.content),
    run_id,
    decided_at: '2025-12-01T00:00:00.000Z',
  };
}

test('render writes only diff and needs-a-decision rows, in section order, and every row parses back', () => {
  const ctx = setup();
  summarize(ctx);
  const res = render(ctx);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.json.status, 'rendered');
  assert.equal(res.json.rows, 7);
  assert.equal(res.json.proposed, 5);
  assert.equal(res.json.needs_decision, 2);
  assert.equal(res.json.held_by_prior_decision, 0);
  assert.equal(res.json.sections, 5);

  const text = readText(join(ctx.runDir, 'proposal.md'));
  const { frontmatter, rows } = parseProposal(text);
  assert.equal(frontmatter.run_id, ctx.runId);
  assert.equal(frontmatter.workspace_id, 'ws-1');
  assert.equal(frontmatter.rule_count, 9);
  assert.equal(frontmatter.proposed, 5);
  assert.equal(frontmatter.held_by_prior_decision, 0);
  assert.match(frontmatter.rubric, /^version: 1$/m);
  assert.match(frontmatter.rubric, /^severities:$/m);
  assert.match(text, /^# Qodo Standards Calibration — proposal$/m);

  // sections: decreases in taxonomy order, then increases, then needs-a-decision
  const headings = text.split('\n').filter((l) => l.startsWith('## '));
  assert.deepEqual(headings, [
    '## Decrease → recommendation · documentation (2) — pre-checked; uncheck to skip',
    '## Decrease → recommendation · naming (1) — pre-checked; uncheck to skip',
    '## Decrease → recommendation · style-formatting (1) — pre-checked; uncheck to skip',
    '## Increase → error · secrets-handling (1) — pre-checked; uncheck to skip',
    '## Needs a decision — guard or category conflict (2) — check to approve',
  ]);
  // rows by numeric id inside a section; unchanged rules never appear
  assert.deepEqual(rows.map((r) => r.rule_id), [99, 101, 102, 103, 104, 105, 106]);
  for (const id of CALIB_UNCHANGED) assert.ok(!text.includes(`- [x] ${id} ·`) && !text.includes(`- [ ] ${id} ·`), `rule ${id} must not appear`);
  // every row parses back to (id, decision, target)
  for (const row of rows) {
    assert.ok(row.ok, `row ${row.line} parses: ${row.raw}`);
    assert.equal(row.checked, CALIB_PRECHECKED.includes(row.rule_id));
    assert.ok(['error', 'warning', 'recommendation'].includes(row.target));
  }
  // needs-a-decision rows are proposed at the rubric severity the veto took away
  const nd = rows.filter((r) => CALIB_DECISIONS.includes(r.rule_id));
  assert.deepEqual(nd.map((r) => r.target), ['recommendation', 'recommendation']);
  assert.deepEqual(nd.map((r) => r.checked), [false, false]);
  // guard terms are comma-joined; the rule's own url wins over the app.qodo.ai fallback
  assert.match(text, /- \[x\] 104 · Never log session tokens · [^·]+ · warning → error · guard: token, secret · https:\/\/portal\.example\.com\/rules\/104$/m);
  assert.match(text, /- \[ \] 105 · .* · guard: sanctions · https:\/\/app\.qodo\.ai\/rules\/105$/m);
  assert.match(text, /- \[ \] 106 · .* · warning → recommendation · https:\/\/app\.qodo\.ai\/rules\/106$/m);
  // footer is always rendered
  assert.match(text, /\n---\nHeld by prior decision: 0 rules \(say "reconsider rule <id>" to release one\)\n$/);
});

test('pre-checked and unchecked rows never share a section', () => {
  const ctx = setup();
  summarize(ctx);
  assert.equal(render(ctx).status, 0);
  const text = readText(join(ctx.runDir, 'proposal.md'));
  let heading = null;
  const seen = new Map();
  for (const line of text.split('\n')) {
    if (line.startsWith('## ')) { heading = line; seen.set(heading, new Set()); continue; }
    const row = /^- \[( |x)\]/.exec(line);
    if (row && heading) seen.get(heading).add(row[1] === 'x');
  }
  for (const [head, states] of seen) {
    assert.equal(states.size, 1, `${head} mixes checked and unchecked rows`);
    assert.equal([...states][0], head.includes('pre-checked; uncheck to skip'));
  }
});

test('render refuses an incomplete classification and names the remaining batches', () => {
  const ctx = setup({ batch2: [{ ruleId: 200, name: 'Later', category: 'Quality', severity: 'warning', content: 'x', guard_hits: [] }] });
  summarize(ctx);
  const res = render(ctx);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /classification is incomplete — 1 batch\(es\) not recorded: 2/);
  assert.ok(!existsSync(join(ctx.runDir, 'proposal.md')));
});

test('render refuses while a rendered row has no summary and lists the ids', () => {
  const ctx = setup();
  summarize(ctx, [99, 101, 102, 103]);
  const res = render(ctx);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /3 row\(s\) have no summary: 104, 105, 106/);
  assert.ok(!existsSync(join(ctx.runDir, 'proposal.md')));
});

test('--summaries-needed lists only rendered rows that lack one, with the full content', () => {
  const ctx = setup();
  const first = run(PROPOSAL, ['--run', ctx.runDir, '--summaries-needed', '--limit', '3'], { env: ctx.env });
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.json.needed_total, 7);
  assert.equal(first.json.returned, 3);
  assert.deepEqual(first.json.rules.map((r) => r.rule_id), [99, 101, 102]);
  assert.equal(first.json.rules[1].content, CALIB_RULES.find((r) => r.ruleId === 101).content);
  for (const id of CALIB_UNCHANGED) assert.ok(!first.json.rules.some((r) => r.rule_id === id));
  summarize(ctx, [99, 101, 102]);
  const next = run(PROPOSAL, ['--run', ctx.runDir, '--summaries-needed'], { env: ctx.env });
  assert.equal(next.json.needed_total, 4);
  assert.deepEqual(next.json.rules.map((r) => r.rule_id), [103, 104, 105, 106]);
});

test('a bad summary refuses the whole chunk and records nothing', () => {
  const ctx = setup();
  const bad = { 99: 'fine', 101: 'has a · separator', 102: 'x'.repeat(200), 103: 'ends with …' };
  const res = run(PROPOSAL, ['--run', ctx.runDir, '--record-summaries', JSON.stringify(bad)], { env: ctx.env });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /ruleId 101: summary contains the field separator/);
  assert.match(res.stderr, /ruleId 102: summary is 200 characters \(max 160\)/);
  assert.match(res.stderr, /ruleId 103: summary contains a truncation mark/);
  assert.ok(!existsSync(join(ctx.runDir, 'summaries.json')));
  const unknown = run(PROPOSAL, ['--run', ctx.runDir, '--record-summaries', '{"4242":"nope"}'], { env: ctx.env });
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /ruleId 4242 is not in this run's classification/);
  assert.ok(!existsSync(join(ctx.runDir, 'summaries.json')));
});

test('summaries merge across chunks and are written atomically', () => {
  const ctx = setup();
  summarize(ctx, [99, 101]);
  const second = summarize(ctx, [102]);
  assert.equal(second.json.summaries_total, 3);
  assert.equal(second.json.still_needed, 4);
  assert.deepEqual(Object.keys(readJson(join(ctx.runDir, 'summaries.json'))), ['99', '101', '102']);
});

test('render refuses to overwrite proposal.md without --replace', () => {
  const ctx = setup();
  summarize(ctx);
  assert.equal(render(ctx).status, 0);
  const again = render(ctx);
  assert.equal(again.status, 2);
  assert.match(again.stderr, /already exists — pass --replace/);
  const replaced = render(ctx, ['--replace']);
  assert.equal(replaced.status, 0, replaced.stderr);
  assert.equal(replaced.json.status, 'replaced');
});

test('a prior skip holds the row while the content is unchanged, and shows in the footer', () => {
  const ctx = setup();
  summarize(ctx);
  seedLedger(ctx, [entry(101, 'skip', 'error')]);
  const res = render(ctx);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.json.held_by_prior_decision, 1);
  assert.equal(res.json.rows, 6);
  const text = readText(join(ctx.runDir, 'proposal.md'));
  assert.ok(!text.includes(' 101 · '));
  assert.match(text, /^Held by prior decision: 1 rules \(say "reconsider rule <id>" to release one\)$/m);
  assert.match(text, /^## Decrease → recommendation · documentation \(1\) — pre-checked; uncheck to skip$/m);
});

test('edited content releases a skip; an override behaves like a skip', () => {
  const ctx = setup();
  summarize(ctx);
  seedLedger(ctx, [entry(101, 'skip', 'error', { content: 'the rule text as it was when the admin skipped it' })]);
  const changed = render(ctx);
  assert.equal(changed.json.held_by_prior_decision, 0);
  assert.ok(readText(join(ctx.runDir, 'proposal.md')).includes(' 101 · '));
  seedLedger(ctx, [entry(102, 'override', 'warning')]);
  const held = render(ctx, ['--replace']);
  assert.equal(held.json.held_by_prior_decision, 1);
});

test('an approve holds only while the severity has not drifted; released always re-renders', () => {
  const ctx = setup();
  summarize(ctx);
  // rule 101 is at error and was approved at error → held even though the rubric now wants less
  seedLedger(ctx, [entry(101, 'approve', 'error')]);
  assert.equal(render(ctx).json.held_by_prior_decision, 1);
  // approved down to recommendation but the rule sits at error again → drifted, re-render
  seedLedger(ctx, [entry(101, 'approve', 'recommendation')]);
  assert.equal(render(ctx, ['--replace']).json.held_by_prior_decision, 0);
  // a release always wins over the entry before it
  seedLedger(ctx, [entry(101, 'skip', 'error'), entry(101, 'released', 'error')]);
  assert.equal(render(ctx, ['--replace']).json.held_by_prior_decision, 0);
});

test('a corrupt ledger line is skipped with a warning instead of stopping the render', () => {
  const ctx = setup();
  summarize(ctx);
  writeFileSync(ctx.ledger, `${JSON.stringify(entry(101, 'skip', 'error'))}\nnot json\n{"decision":"skip"}\n\n`);
  const res = render(ctx);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.json.held_by_prior_decision, 1);
  assert.match(res.stderr, /skipping unreadable line/);
  assert.match(res.stderr, /skipping line without a rule_id/);
});

test('row grammar round-trips, including guard lists and an odd name', () => {
  const row = {
    rule_id: 815399, name: 'Use A → B only via the façade · always', summary: 'One line, no separators',
    current: 'error', target: 'recommendation', guard_hits: ['auth', 'personal data'], url: 'https://app.qodo.ai/rules/815399', checked: true,
  };
  const line = renderRow(row);
  assert.equal(line, '- [x] 815399 · Use A → B only via the façade · always · One line, no separators · error → recommendation · guard: auth, personal data · https://app.qodo.ai/rules/815399');
  const back = parseRow(line, 12);
  assert.equal(back.ok, true);
  assert.equal(back.line, 12);
  assert.equal(back.rule_id, 815399);
  assert.equal(back.checked, true);
  assert.equal(back.current, 'error');
  assert.equal(back.target, 'recommendation');
  assert.deepEqual(back.guard_hits, ['auth', 'personal data']);
  assert.equal(back.url, 'https://app.qodo.ai/rules/815399');
  // an unchecked row and an edited target still parse; "critical" is a target, not a mangled row
  const edited = parseRow('- [ ] 42 · N · S · warning → critical · https://x/42', 3);
  assert.equal(edited.ok, true);
  assert.equal(edited.checked, false);
  assert.equal(edited.target, 'critical');
  // a deleted separator is unparseable
  assert.equal(parseRow('- [x] 42 · N · S · warning → recommendation https://x/42', 4).ok, false);
  assert.equal(parseRow('- [x] 42 · N · S · warning → recommendation https://x/42', 4).reason, 'unparseable row');
  // a rule sitting at a severity this skill does not know still parses; the reader compares the
  // current field against the classification row rather than the grammar
  const odd = parseRow('- [ ] 42 · N · S · critical → warning · https://x/42', 5);
  assert.equal(odd.ok, true);
  assert.equal(odd.rule_id, 42);
  assert.equal(odd.current, 'critical');
  assert.equal(odd.target, 'warning');
  // a newline in a name or summary collapses so the row stays one line
  assert.equal(
    renderRow({ rule_id: 7, name: 'Two\nlines', summary: 'also\r\ntwo', current: 'error', target: 'warning', guard_hits: [], url: 'https://x/7', checked: true }),
    '- [x] 7 · Two lines · also two · error → warning · https://x/7',
  );
});

test('validateSummary enforces the display contract', () => {
  assert.equal(validateSummary('A single clear sentence about the rule'), null);
  assert.match(validateSummary(''), /empty/);
  assert.match(validateSummary('   '), /empty/);
  assert.match(validateSummary('a'.repeat(161)), /161 characters/);
  assert.match(validateSummary('one\ntwo'), /newline/);
  assert.match(validateSummary('a · b'), /field separator/);
  assert.match(validateSummary('a → b'), /"→"/);
  assert.match(validateSummary('truncated...'), /truncation mark/);
  assert.match(validateSummary(42), /must be a string/);
});

test('rows recorded before rubric_proposed existed take the target from the run snapshot', () => {
  const ctx = setup();
  summarize(ctx);
  // a 0.2.0 classification.json: no rubric_proposed on any row
  const path = join(ctx.runDir, 'classification.json');
  const legacy = readJson(path).map(({ rubric_proposed, ...rest }) => rest);
  assert.ok(!Object.hasOwn(legacy[0], 'rubric_proposed'));
  writeFileSync(path, JSON.stringify(legacy, null, 1));
  const res = render(ctx);
  assert.equal(res.status, 0, res.stderr);
  const { rows } = parseProposal(readText(join(ctx.runDir, 'proposal.md')));
  const nd = rows.filter((r) => CALIB_DECISIONS.includes(r.rule_id));
  // 105 is documentation, 106 is naming — both recommendation in the snapshot
  assert.deepEqual(nd.map((r) => [r.rule_id, r.current, r.target]), [[105, 'warning', 'recommendation'], [106, 'warning', 'recommendation']]);
  const rb = run(APPROVE, ['--run', ctx.runDir, '--readback'], { env: ctx.env });
  assert.equal(rb.status, 0, rb.stderr);
  assert.deepEqual(rb.json.counts, { approve: 5, skip: 2, override: 0, invalid: 0, removed: 0 });
  assert.equal(rb.json.rows.find((r) => r.rule_id === 105).target, 'recommendation');
});

test('--summaries-file records the same chunk as --record-summaries', () => {
  const ctx = setup();
  const path = join(ctx.runDir, 'chunk.json');
  writeFileSync(path, JSON.stringify(summariesFor([99, 101])));
  const res = run(PROPOSAL, ['--run', ctx.runDir, '--summaries-file', path], { env: ctx.env });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.json.recorded, 2);
  assert.deepEqual(Object.keys(readJson(join(ctx.runDir, 'summaries.json'))), ['99', '101']);
  const both = run(PROPOSAL, ['--run', ctx.runDir, '--record-summaries', '{}', '--summaries-file', path], { env: ctx.env });
  assert.equal(both.status, 1);
  assert.match(both.stderr, /either --record-summaries or --summaries-file, not both/);
});

test('a hand-edited summaries.json is re-validated at render, and blank counts as missing', () => {
  const ctx = setup();
  summarize(ctx);
  const path = join(ctx.runDir, 'summaries.json');
  const summaries = readJson(path);
  summaries['101'] = 'now with a · separator';
  summaries['102'] = `padded to ${'x'.repeat(200)}`;
  writeFileSync(path, JSON.stringify(summaries));
  const res = render(ctx);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /2 recorded summary\(ies\) are no longer valid/);
  assert.match(res.stderr, /ruleId 101: summary contains the field separator/);
  assert.match(res.stderr, /ruleId 102: summary is \d+ characters/);
  assert.ok(!existsSync(join(ctx.runDir, 'proposal.md')));
  // whitespace-only is missing, not invalid, everywhere
  summaries['101'] = 'fine again';
  summaries['102'] = '   ';
  writeFileSync(path, JSON.stringify(summaries));
  const blank = render(ctx);
  assert.equal(blank.status, 2);
  assert.match(blank.stderr, /1 row\(s\) have no summary: 102/);
  const needed = run(PROPOSAL, ['--run', ctx.runDir, '--summaries-needed'], { env: ctx.env });
  assert.deepEqual(needed.json.rules.map((r) => r.rule_id), [102]);
});

test('a rendered row whose exported rule has no content is named, not silently empty', () => {
  const ctx = setup();
  // rewrite export.json without rule 103's content and without rule 104 at all
  const exportPath = join(ctx.runDir, 'export.json');
  const data = readJson(exportPath);
  data.rules = data.rules.filter((r) => r.ruleId !== 104).map((r) => (r.ruleId === 103 ? { ...r, content: null } : r));
  writeFileSync(exportPath, JSON.stringify(data));
  const needed = run(PROPOSAL, ['--run', ctx.runDir, '--summaries-needed'], { env: ctx.env });
  assert.equal(needed.status, 0, needed.stderr);
  assert.equal(needed.json.needed_total, 7);
  assert.deepEqual(needed.json.missing_content, [103, 104]);
  assert.deepEqual(needed.json.rules.map((r) => r.rule_id), [99, 101, 102, 105, 106]);
  for (const r of needed.json.rules) assert.equal(typeof r.content, 'string');
  summarize(ctx, [99, 101, 102, 105, 106]);
  const res = render(ctx);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /No exported content for 103, 104 — re-export/);
});

test('a run folder missing one of its files is refused by both scripts with a named message', () => {
  for (const file of ['classification.json', 'export.json', 'rubric-snapshot.yaml']) {
    const ctx = setup();
    summarize(ctx);
    rmSync(join(ctx.runDir, file));
    const res = render(ctx);
    assert.equal(res.status, 2, `${file}: ${res.stdout}`);
    assert.match(res.stderr, new RegExp(`${file.replace('.', '\\.')} missing`));
    assert.ok(!existsSync(join(ctx.runDir, 'proposal.md')));
    const rb = run(APPROVE, ['--run', ctx.runDir, '--readback'], { env: ctx.env });
    assert.equal(rb.status, 2);
    assert.match(rb.stderr, new RegExp(`${file.replace('.', '\\.')} missing`));
  }
});

test('a malformed run file is a plain refusal, not a crash', () => {
  const ctx = setup();
  summarize(ctx);
  writeFileSync(join(ctx.runDir, 'export.json'), JSON.stringify([{ ruleId: 1 }]));
  const asArray = render(ctx);
  assert.equal(asArray.status, 2);
  assert.match(asArray.stderr, /must be a JSON object with a rules array/);
  const ctx2 = setup();
  summarize(ctx2);
  writeFileSync(join(ctx2.runDir, 'classification.json'), JSON.stringify([{ rule_id: 1, direction: 'none' }, 'nope']));
  const badRow = render(ctx2);
  assert.equal(badRow.status, 2);
  assert.match(badRow.stderr, /not a classification row/);
  const ctx3 = setup();
  writeFileSync(join(ctx3.runDir, 'summaries.json'), '[]');
  const badSummaries = run(PROPOSAL, ['--run', ctx3.runDir, '--summaries-needed'], { env: ctx3.env });
  assert.equal(badSummaries.status, 2);
  assert.match(badSummaries.stderr, /must be a JSON object/);
});

test('parseFrontmatter says what is wrong and coerces only the count keys', () => {
  const ok = parseFrontmatter('---\nrun_id: 20260101-000000\nrule_count: 9\nproposed: 5\nheld_by_prior_decision: 0\nworkspace_id: 12345\nrubric: |\n  version: 1\n---\nbody\n');
  assert.equal(ok.error, null);
  assert.equal(ok.frontmatter.run_id, '20260101-000000');
  assert.equal(ok.frontmatter.workspace_id, '12345'); // an all-digit id stays a string
  assert.equal(ok.frontmatter.rule_count, 9);
  assert.equal(ok.frontmatter.proposed, 5);
  assert.equal(ok.frontmatter.held_by_prior_decision, 0);
  assert.equal(ok.frontmatter.rubric, 'version: 1\n');
  assert.equal(parseFrontmatter('# just a heading\n- [x] 1 · a · b · error → warning · u\n').error, 'missing');
  assert.equal(parseFrontmatter('---\nrun_id: 20260101-000000\nrubric: |\n  version: 1\n').error, 'unterminated');
});
