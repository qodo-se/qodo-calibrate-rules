#!/usr/bin/env node
// approve.mjs — read the admin's edited proposal.md back, then record their skips.
//
// Usage:
//   node approve.mjs --run <run-dir> --readback
//   node approve.mjs --run <run-dir> --record-skips
//
// --readback parses <run-dir>/proposal.md and prints one JSON object: the decision per row
// (checkbox = approve/skip, an edited target = override), every invalid row by line number with
// its reason, how many rows were deleted from the file, and the readback line to show the admin.
// It writes nothing. --record-skips appends the readback's skip rows to the decisions ledger so
// the next run does not re-propose them; a rule this run has already recorded as skipped is
// left alone, so recording again after the admin unchecks another row appends only the new one.
// Approvals and overrides are recorded after they are applied, which this version does not do.
//
// Exit codes: 0 ok, 1 usage / Node too old, 2 refused (no proposal, run id mismatch).

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { compareRuleIds, isSeverity, requireNode20 } from './lib/calibrate-lib.mjs';
import { appendEntries, contentHash, isHeld, latestByRule, ledgerPath, makeEntry, readLedger } from './lib/ledger-lib.mjs';
import { hasContent, isRendered, loadRun, parseProposal, RunError, targetFor } from './lib/proposal-lib.mjs';

requireNode20();

function fail(code, message) {
  process.stderr.write(`approve: ${message}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const args = { run: null, readback: false, recordSkips: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) fail(1, `missing value for ${a}`);
      return argv[++i];
    };
    if (a === '--run') args.run = next();
    else if (a === '--readback') args.readback = true;
    else if (a === '--record-skips') args.recordSkips = true;
    else if (a === '-h' || a === '--help') {
      process.stdout.write('usage: node approve.mjs --run <run-dir> (--readback | --record-skips)\n');
      process.exit(0);
    } else fail(1, `unknown argument: ${a}`);
  }
  if (!args.run) fail(1, '--run <run-dir> is required');
  if (args.readback === args.recordSkips) fail(1, 'pass exactly one of --readback, --record-skips');
  return args;
}

function readbackText(counts, invalid) {
  let text = `${counts.approve} approve · ${counts.skip} skip · ${counts.override} override · ${counts.invalid} invalid override`;
  if (invalid.length) {
    const byReason = new Map();
    for (const row of invalid) {
      const key = row.reason;
      if (!byReason.has(key)) byReason.set(key, []);
      byReason.get(key).push(row.line);
    }
    const groups = [...byReason.entries()].map(([reason, lines]) => `rows ${lines.join(', ')}: ${reason}`);
    text += ` (${groups.join('; ')})`;
  }
  return text;
}

function readback(runDir) {
  let run;
  try {
    run = loadRun(runDir);
  } catch (e) {
    if (e instanceof RunError) fail(e.code, e.message);
    throw e;
  }
  const proposalPath = join(runDir, 'proposal.md');
  if (!existsSync(proposalPath)) fail(2, `${proposalPath} missing — render the proposal first (proposal.mjs --render)`);
  const parsed = parseProposal(readFileSync(proposalPath, 'utf8'));
  if (parsed.error === 'missing') fail(2, `${proposalPath} has no frontmatter — a proposal starts with the run's \`---\` block. Do not hand-write the file; re-render it with proposal.mjs.`);
  if (parsed.error === 'unterminated') fail(2, `${proposalPath} frontmatter is not terminated — the closing \`---\` line is missing. Restore it, or re-render the proposal.`);
  if (String(parsed.frontmatter.run_id ?? '') !== run.runId) {
    fail(2, `${proposalPath} frontmatter run_id "${parsed.frontmatter.run_id ?? ''}" does not match the run folder "${run.runId}" — the file belongs to another run.`);
  }

  // What this run rendered: a rubric-proposed change or a needs-a-decision row, minus rows a
  // prior decision holds — with this run's own skip entries ignored, so a readback repeated
  // after --record-skips sees exactly the rows that were rendered. A row for anything else
  // (unchanged, held, or invented) is not a decision this run can carry. Rows the admin deleted
  // from the file show up as `removed`.
  const ledger = readLedger(ledgerPath());
  const atRender = latestByRule(ledger.filter((e) => !(e.decision === 'skip' && String(e.run_id) === run.runId)));
  const expected = new Map();
  for (const row of run.rows) {
    const key = String(row.rule_id);
    if (isRendered(row) && !isHeld(row, run.rules.get(key), atRender.get(key))) expected.set(key, row);
  }

  const seen = new Map();
  for (const row of parsed.rows) if (row.rule_id !== null) seen.set(String(row.rule_id), (seen.get(String(row.rule_id)) ?? 0) + 1);

  const rows = [];
  const invalid = [];
  for (const parsedRow of parsed.rows) {
    const key = String(parsedRow.rule_id);
    const add = (reason) => invalid.push({ line: parsedRow.line, rule_id: parsedRow.rule_id, reason, raw: parsedRow.raw });
    if (!parsedRow.ok) {
      add(parsedRow.reason);
      continue;
    }
    const row = expected.get(key);
    if (!row) {
      add(`rule ${parsedRow.rule_id} was not proposed in this run`);
      continue;
    }
    if (seen.get(key) > 1) {
      add(`duplicate rule id ${parsedRow.rule_id}`);
      continue;
    }
    // The current severity is display-only, so an edit to it means the row no longer describes
    // the rule it names: report it instead of deciding from a changed premise.
    if (String(parsedRow.current) !== String(row.current)) {
      add('current severity was edited');
      continue;
    }
    const rendered = targetFor(row, run.snapshot);
    const entry = { line: parsedRow.line, rule_id: row.rule_id, current: row.current, target: parsedRow.target, rendered_target: rendered, tag: row.tag };
    if (!parsedRow.checked) {
      rows.push({ ...entry, decision: 'skip', target: rendered });
      continue;
    }
    if (!isSeverity(parsedRow.target)) {
      add(`"${parsedRow.target}" is not a severity`);
      continue;
    }
    if (parsedRow.target === row.current) {
      add(`"${parsedRow.target}" equals current severity`);
      continue;
    }
    rows.push({ ...entry, decision: parsedRow.target === rendered ? 'approve' : 'override' });
  }

  const removedIds = [...expected.values()].filter((row) => !seen.has(String(row.rule_id))).map((row) => row.rule_id).sort(compareRuleIds);
  const counts = {
    approve: rows.filter((r) => r.decision === 'approve').length,
    skip: rows.filter((r) => r.decision === 'skip').length,
    override: rows.filter((r) => r.decision === 'override').length,
    invalid: invalid.length,
    removed: removedIds.length,
  };
  return { run, proposalPath, frontmatter: parsed.frontmatter, rows, invalid, counts, removedIds, expected: expected.size, readback_text: readbackText(counts, invalid) };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const runDir = resolve(args.run);
  const result = readback(runDir);

  if (args.readback) {
    process.stdout.write(`${JSON.stringify({
      run_dir: runDir,
      status: 'ok',
      run_id: result.run.runId,
      proposal: result.proposalPath,
      rendered_rows: result.expected,
      counts: result.counts,
      rows: result.rows,
      invalid: result.invalid,
      removed: result.counts.removed,
      removed_ids: result.removedIds,
      readback_text: result.readback_text,
    })}\n`);
    return;
  }

  // --record-skips: the only ledger write in this version. Recording is per (run, rule), not
  // per run: a rule this run already skipped is left alone, so confirming again after the admin
  // unchecks another row appends only that row, and an unchanged file appends nothing.
  const path = ledgerPath();
  const latest = latestByRule(readLedger(path));
  const warnings = [];
  const already = [];
  const entries = [];
  for (const r of result.rows.filter((row) => row.decision === 'skip')) {
    const prior = latest.get(String(r.rule_id));
    if (prior && prior.decision === 'skip' && String(prior.run_id) === result.run.runId) {
      already.push(r.rule_id);
      continue;
    }
    const rule = result.run.rules.get(String(r.rule_id));
    if (!hasContent(rule)) warnings.push(`rule ${r.rule_id} has no exported content — recorded without a content hash, so it will be proposed again`);
    entries.push(makeEntry({
      rule_id: r.rule_id,
      decision: 'skip',
      severity_at_decision: r.current,
      content_hash: hasContent(rule) ? contentHash(rule.content) : null,
      run_id: result.run.runId,
    }));
  }
  appendEntries(entries, path);
  process.stdout.write(`${JSON.stringify({
    ledger_path: path,
    status: entries.length ? 'recorded' : already.length ? 'already_recorded' : 'nothing_to_record',
    run_id: result.run.runId,
    recorded: entries.length,
    rule_ids: entries.map((e) => e.rule_id),
    already_recorded: already,
    counts: result.counts,
    warnings,
  })}\n`);
}

main();
