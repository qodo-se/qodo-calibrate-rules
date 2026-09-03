#!/usr/bin/env node
// proposal.mjs — the agent's one-line summaries, then the proposal checklist.
//
// Usage:
//   node proposal.mjs --run <run-dir> --summaries-needed [--limit N]
//   node proposal.mjs --run <run-dir> (--record-summaries '<json>' | --summaries-file <path>)
//   node proposal.mjs --run <run-dir> --render --workspace-id <id> [--replace]
//
// Summaries normally arrive with the classification (record-batch.mjs, one pass over the rule
// text). --summaries-needed is the repair path: it lists the rules that will appear in the
// proposal and still lack a summary (rule_id, name, and the full content to write it from), 10 at
// a time unless --limit says otherwise. --record-summaries validates a chunk and merges it into
// <run-dir>/summaries.json atomically (that file overrides a summary recorded with the row); an
// invalid summary refuses the whole chunk and records nothing. --render writes <run-dir>/proposal.md, refusing on an incomplete
// classification, a missing summary, or an existing proposal.md without --replace. Rules the
// admin already decided (decisions.jsonl) are held out of the proposal and counted in its footer.
// Read-only against the workspace.
//
// Exit codes: 0 ok, 1 usage / Node too old, 2 refused (nothing written).

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { compareRuleIds, requireNode20 } from './lib/calibrate-lib.mjs';
import { isHeld, latestByRule, ledgerPath, readLedger } from './lib/ledger-lib.mjs';
import { buildSections, hasContent, hasSummary, isRendered, loadRun, mergedSummaries, renderProposal, ruleUrl, RunError, targetFor, validateSummary } from './lib/proposal-lib.mjs';

requireNode20();

const DEFAULT_LIMIT = 10;

function fail(code, message) {
  process.stderr.write(`proposal: ${message}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const args = { run: null, summariesNeeded: false, limit: DEFAULT_LIMIT, recordSummaries: null, summariesFile: null, render: false, workspaceId: null, replace: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) fail(1, `missing value for ${a}`);
      return argv[++i];
    };
    if (a === '--run') args.run = next();
    else if (a === '--summaries-needed') args.summariesNeeded = true;
    else if (a === '--limit') args.limit = Number(next());
    else if (a === '--record-summaries') args.recordSummaries = next();
    else if (a === '--summaries-file') args.summariesFile = next();
    else if (a === '--render') args.render = true;
    else if (a === '--workspace-id') args.workspaceId = next();
    else if (a === '--replace') args.replace = true;
    else if (a === '-h' || a === '--help') {
      process.stdout.write("usage: node proposal.mjs --run <run-dir> (--summaries-needed [--limit N] | --record-summaries '<json>' | --summaries-file <path> | --render --workspace-id <id> [--replace])\n");
      process.exit(0);
    } else fail(1, `unknown argument: ${a}`);
  }
  if (!args.run) fail(1, '--run <run-dir> is required');
  if (args.recordSummaries !== null && args.summariesFile !== null) fail(1, 'pass either --record-summaries or --summaries-file, not both');
  const modes = [args.summariesNeeded, Boolean(args.recordSummaries || args.summariesFile), args.render].filter(Boolean);
  if (modes.length !== 1) fail(1, 'pass exactly one of --summaries-needed, --record-summaries/--summaries-file, --render');
  if (!Number.isInteger(args.limit) || args.limit < 1) fail(1, '--limit N (N >= 1) must be a positive integer');
  if (args.render && !args.workspaceId) fail(1, '--render needs --workspace-id <id> (from qodo read whoami)');
  return args;
}

function load(runDir) {
  try {
    return loadRun(runDir);
  } catch (e) {
    if (e instanceof RunError) fail(e.code, e.message);
    throw e;
  }
}

// The rows that belong in the proposal: a rubric-proposed change or a needs-a-decision row,
// minus everything a prior decision holds.
function renderable(run) {
  const latest = latestByRule(readLedger(ledgerPath()));
  const candidates = run.rows.filter(isRendered);
  const held = [];
  const rows = [];
  for (const row of candidates) {
    const key = String(row.rule_id);
    if (isHeld(row, run.rules.get(key), latest.get(key))) held.push(row);
    else rows.push(row);
  }
  return { rows, held };
}

function writeAtomic(path, text) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const runDir = resolve(args.run);
  const run = load(runDir);
  const { rows, held } = renderable(run);

  if (args.summariesNeeded) {
    const needed = rows
      .filter((r) => !hasSummary(run.summaries, r.rule_id))
      .sort((a, b) => compareRuleIds(a.rule_id, b.rule_id));
    const withContent = needed.filter((r) => hasContent(run.rules.get(String(r.rule_id))));
    const missingContent = needed.filter((r) => !hasContent(run.rules.get(String(r.rule_id)))).map((r) => r.rule_id);
    const slice = withContent.slice(0, args.limit);
    process.stdout.write(`${JSON.stringify({
      run_dir: runDir,
      status: 'ok',
      rendered_rows: rows.length,
      held_by_prior_decision: held.length,
      needed_total: needed.length,
      returned: slice.length,
      // Rows whose exported rule is gone or carries no content string: no summary can be written
      // from the rule text, and the export is the thing to fix.
      missing_content: missingContent,
      rules: slice.map((r) => ({ rule_id: r.rule_id, name: r.name, tag: r.tag, content: run.rules.get(String(r.rule_id)).content })),
    })}\n`);
    return;
  }

  if (args.recordSummaries || args.summariesFile) {
    let chunk;
    try {
      chunk = JSON.parse(args.summariesFile ? readFileSync(resolve(args.summariesFile), 'utf8') : args.recordSummaries);
    } catch (e) {
      fail(2, `summaries are not valid JSON: ${e.message}`);
    }
    if (!chunk || typeof chunk !== 'object' || Array.isArray(chunk)) fail(2, 'summaries must be a JSON object {"<ruleId>": "<summary>"}');
    const known = new Set(run.rows.map((r) => String(r.rule_id)));
    const issues = [];
    for (const [id, summary] of Object.entries(chunk)) {
      if (!known.has(id)) issues.push(`ruleId ${id} is not in this run's classification`);
      else {
        const reason = validateSummary(summary);
        if (reason) issues.push(`ruleId ${id}: ${reason}`);
      }
    }
    if (issues.length) fail(2, `no summaries recorded:\n  - ${issues.join('\n  - ')}`);
    const merged = { ...run.summaryOverrides };
    for (const [id, summary] of Object.entries(chunk)) merged[id] = summary.trim();
    const ordered = {};
    for (const id of Object.keys(merged).sort(compareRuleIds)) ordered[id] = merged[id];
    writeAtomic(run.summariesPath, `${JSON.stringify(ordered, null, 1)}\n`);
    const effective = mergedSummaries(run.rows, ordered);
    const stillNeeded = rows.filter((r) => !hasSummary(effective, r.rule_id)).length;
    process.stdout.write(`${JSON.stringify({
      run_dir: runDir,
      status: 'recorded',
      recorded: Object.keys(chunk).length,
      summaries_total: Object.keys(effective).length,
      rendered_rows: rows.length,
      still_needed: stillNeeded,
    })}\n`);
    return;
  }

  // --render
  if (run.batchesRemaining.length) {
    fail(2, `classification is incomplete — ${run.batchesRemaining.length} batch(es) not recorded: ${run.batchesRemaining.join(', ')}. Classify them first (record-batch.mjs --status).`);
  }
  const proposalPath = join(runDir, 'proposal.md');
  if (existsSync(proposalPath) && !args.replace) {
    fail(2, `${proposalPath} already exists — pass --replace to overwrite it (ask the admin first if they have edited it).`);
  }
  const missing = rows.filter((r) => !hasSummary(run.summaries, r.rule_id)).map((r) => r.rule_id).sort(compareRuleIds);
  if (missing.length) {
    const noContent = missing.filter((id) => !hasContent(run.rules.get(String(id))));
    const note = noContent.length ? ` No exported content for ${noContent.join(', ')} — re-export if the rules still exist.` : '';
    fail(2, `${missing.length} row(s) have no summary: ${missing.join(', ')}. Record them with --record-summaries first.${note}`);
  }
  // summaries.json is a plain file an admin or a script can edit; never render one that would
  // break the row grammar.
  const invalid = rows
    .map((r) => [r.rule_id, validateSummary(run.summaries[String(r.rule_id)])])
    .filter(([, reason]) => reason);
  if (invalid.length) {
    fail(2, `${invalid.length} recorded summary(ies) are no longer valid:\n  - ${invalid.map(([id, reason]) => `ruleId ${id}: ${reason}`).join('\n  - ')}\nRe-record them with --record-summaries.`);
  }

  const displayRows = rows.map((row) => {
    const rule = run.rules.get(String(row.rule_id));
    return {
      rule_id: row.rule_id,
      name: row.name,
      summary: run.summaries[String(row.rule_id)].trim(),
      current: row.current,
      target: targetFor(row, run.snapshot),
      guard_hits: row.guard_hits,
      url: ruleUrl(rule, row.rule_id),
      tag: row.tag,
      direction: row.direction,
      needs_decision: Boolean(row.needs_decision),
      checked: !row.needs_decision,
    };
  });
  const sections = buildSections(displayRows);
  const proposed = displayRows.filter((r) => r.checked).length;
  const text = renderProposal({
    run_id: run.runId,
    workspace_id: args.workspaceId,
    rule_count: run.rows.length,
    proposed,
    held_by_prior_decision: held.length,
    rubric: run.rubricText,
    sections,
  });
  const replaced = existsSync(proposalPath);
  writeAtomic(proposalPath, text);
  process.stdout.write(`${JSON.stringify({
    run_dir: runDir,
    status: replaced ? 'replaced' : 'rendered',
    path: proposalPath,
    run_id: run.runId,
    workspace_id: args.workspaceId,
    rule_count: run.rows.length,
    rows: displayRows.length,
    proposed,
    needs_decision: displayRows.length - proposed,
    held_by_prior_decision: held.length,
    sections: sections.length,
  })}\n`);
}

main();
