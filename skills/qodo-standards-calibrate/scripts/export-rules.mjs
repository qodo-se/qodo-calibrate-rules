#!/usr/bin/env node
// export-rules.mjs — page every active Review Standards rule into a run folder.
//
// Usage:
//   node export-rules.mjs --out <run-dir> [--qodo <launcher>] [--read-args "read rules list"]
//
// Requires <run-dir>/rubric-snapshot.yaml (written by rubric.mjs); its guard_terms drive the
// precomputed guard hits. Writes <run-dir>/export.json (raw rules + totalCount, exported_at,
// run_id), <run-dir>/batches/batch-NNN.json (40 rules each: ruleId, name, category,
// severity, content, guard_hits[]) and, beside each, batch-NNN.txt — the same rules as plain
// text, which is what a classifier reads (no JSON escaping, ~10% fewer tokens, nothing to dump). Read-only against the workspace: the only Qodo command it
// runs is the catalog's read command for rules-list. Node >= 20, built-ins only.
//
// Exit codes: 0 exported (or already exported), 1 usage / Node too old, 2 export failed.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { buildGuardMatchers, compareRuleIds, guardHits, parseSnapshot, requireNode20, validateSnapshot } from './lib/calibrate-lib.mjs';
import { errorOf, forwardStderr, parseJsonOutput, RATE_LIMIT_CODE, sleep, spawnLauncher, stderrTail, TIMEOUT_MS, TRUNCATED_CODE } from './lib/launcher-lib.mjs';

requireNode20();

const PAGE_SIZE = 100; // rules-list maximum; halved when the runtime truncates a page
const MIN_PAGE_SIZE = 10;
const BATCH_SIZE = 40;
const RATE_LIMIT_WAIT_MS = 5000;
const PAGE_TIMEOUT_MS = TIMEOUT_MS;
const DEFAULT_READ_ARGS = 'read rules list';

function fail(code, message) {
  process.stderr.write(`export-rules: ${message}\n`);
  process.exit(code);
}

function usage(code) {
  const text = `usage: node export-rules.mjs --out <run-dir> [--qodo <launcher>] [--read-args "${DEFAULT_READ_ARGS}"]\n`;
  (code === 0 ? process.stdout : process.stderr).write(text);
  process.exit(code);
}

function parseArgs(argv) {
  const args = { out: null, qodo: 'qodo', readArgs: DEFAULT_READ_ARGS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) fail(1, `missing value for ${a}`);
      return argv[++i];
    };
    if (a === '--out') args.out = next();
    else if (a === '--qodo') args.qodo = next();
    else if (a === '--read-args') args.readArgs = next();
    else if (a === '-h' || a === '--help') usage(0);
    else fail(1, `unknown argument: ${a}`);
  }
  if (!args.out) usage(1);
  args.readArgs = args.readArgs.trim().split(/\s+/).filter(Boolean);
  if (!args.readArgs.length) fail(1, '--read-args must name the rules-list read command, e.g. "read rules list"');
  return args;
}

function runPage(launcher, readArgs, page, pageSize) {
  const argv = [...readArgs, '--state', 'active', '--page-size', String(pageSize), '--page', String(page), '--json'];
  const res = spawnLauncher(launcher, argv);
  const tail = stderrTail(res.stderr);
  const withTail = (err) => ({ error: err, tail });
  if (res.error) {
    if (res.error.code === 'ETIMEDOUT') return withTail({ code: 'timeout', message: `page ${page} did not finish within ${PAGE_TIMEOUT_MS / 1000} s` });
    return withTail({ code: 'spawn_failed', message: `${launcher}: ${res.error.message}` });
  }
  // Forward notices (e.g. QODO_NOTICE) but drop the CLI's trace lines.
  forwardStderr(res.stderr);
  if ((res.stderr || '').includes(RATE_LIMIT_CODE)) return withTail({ code: RATE_LIMIT_CODE, message: 'rate limited (reported on stderr)' });
  const parsed = parseJsonOutput(res.stdout);
  if (parsed.error) return withTail(parsed.error);
  const err = errorOf(parsed.payload);
  if (err) return withTail(err);
  if (res.status !== 0) return withTail({ code: 'non_zero_exit', message: `launcher exited ${res.status}` });
  const { payload } = parsed;
  if (!Array.isArray(payload.rules) || typeof payload.totalCount !== 'number') {
    return withTail({ code: 'unexpected_shape', message: `expected {page,totalCount,rules[]}, got keys ${Object.keys(payload).join(',')}` });
  }
  return { payload };
}

function fetchPage(launcher, readArgs, page, pageSize) {
  let attempt = runPage(launcher, readArgs, page, pageSize);
  if (attempt.error && attempt.error.code === RATE_LIMIT_CODE) {
    process.stderr.write(`export-rules: page ${page} rate limited (${RATE_LIMIT_CODE}); waiting ${RATE_LIMIT_WAIT_MS / 1000}s and retrying once\n`);
    sleep(RATE_LIMIT_WAIT_MS);
    attempt = runPage(launcher, readArgs, page, pageSize);
  }
  return attempt;
}

function describe(result, page, pageSize) {
  const e = result.error;
  const tail = result.tail ? ` (stderr: ${result.tail})` : '';
  return `page ${page} (page size ${pageSize}) failed: ${e.code} — ${e.message}${tail}`;
}

// Pages the whole active set. On a truncated page the page size is halved and paging resumes
// from the already-fetched prefix (after N-1 full pages of size S, page 2(N-1)+1 of size S/2).
function fetchAll(launcher, readArgs) {
  let pageSize = PAGE_SIZE;
  let page = 1;
  let rules = [];
  let totalCount = null;
  let pages = 0;
  for (;;) {
    const result = fetchPage(launcher, readArgs, page, pageSize);
    if (result.error) {
      if (result.error.code !== TRUNCATED_CODE) {
        fail(2, `${describe(result, page, pageSize)}; fetched ${rules.length} of ${totalCount ?? 'unknown'} before the failure. Nothing written.`);
      }
      const smaller = Math.floor(pageSize / 2);
      if (smaller < MIN_PAGE_SIZE) fail(2, `page ${page} still truncated at page size ${pageSize} and the minimum is ${MIN_PAGE_SIZE} (${result.error.message}). Nothing written.`);
      if (rules.length % smaller === 0) {
        page = rules.length / smaller + 1;
        process.stderr.write(`export-rules: page truncated by the runtime (${result.error.message}); keeping ${rules.length} fetched rules and continuing at page ${page} with page size ${smaller}\n`);
      } else {
        page = 1;
        rules = [];
        process.stderr.write(`export-rules: page truncated by the runtime (${result.error.message}); page size ${smaller} does not align with the fetched prefix, restarting from page 1\n`);
      }
      pageSize = smaller;
      continue;
    }
    const { payload } = result;
    pages++;
    if (totalCount === null) totalCount = payload.totalCount;
    else if (payload.totalCount !== totalCount) {
      fail(2, `totalCount changed during paging (${totalCount} → ${payload.totalCount} on page ${page}); rules changed under us. Re-run. Nothing written.`);
    }
    if (payload.rules.length === 0) break;
    rules.push(...payload.rules);
    if (rules.length > totalCount) fail(2, `paging is not advancing: ${rules.length} rules after page ${page} exceeds totalCount ${totalCount}. Nothing written.`);
    if (rules.length >= totalCount) break;
    page++;
  }
  return { rules, totalCount, pages, pageSize };
}

// The plain-text view of a batch: a header line per rule, then its content verbatim.
export function renderBatchText(runId, batchNo, rules) {
  const out = [`# run ${runId} · batch ${batchNo} · ${rules.length} rules`, ''];
  for (const r of rules) {
    const guard = r.guard_hits && r.guard_hits.length ? r.guard_hits.join(', ') : '-';
    out.push(`=== ${r.ruleId} | ${r.name} | category=${r.category} | severity=${r.severity} | guard=${guard}`);
    out.push(String(r.content ?? '(no content)').replace(/\s+$/, ''));
    out.push('');
  }
  out.push(`IDS=${rules.map((r) => r.ruleId).join(',')}`);
  return `${out.join('\n')}\n`;
}

// The batch files proper are the .json ones; `withViews` adds their .txt siblings (for cleanup).
function batchFiles(dir, withViews = false) {
  const re = withViews ? /^batch-\d{3}\.(json|txt)$/ : /^batch-\d{3}\.json$/;
  return existsSync(dir) ? readdirSync(dir).filter((f) => re.test(f)) : [];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = resolve(args.out);
  const runId = basename(outDir);
  const exportPath = join(outDir, 'export.json');
  const batchesDir = join(outDir, 'batches');
  const snapshotPath = join(outDir, 'rubric-snapshot.yaml');

  if (existsSync(exportPath)) {
    let existing;
    try { existing = JSON.parse(readFileSync(exportPath, 'utf8')); } catch (e) { fail(2, `${exportPath} is not valid JSON (${e.message}); remove export.json to re-export.`); }
    const existingBatches = batchFiles(batchesDir).length;
    if (existing.totalCount > 0 && existingBatches === 0) fail(2, `${exportPath} is present but ${batchesDir} is missing or empty; remove export.json to re-export.`);
    process.stdout.write(`${JSON.stringify({ run_id: runId, status: 'already_exported', totalCount: existing.totalCount, exported: Array.isArray(existing.rules) ? existing.rules.length : null, export: exportPath, batches: existingBatches })}\n`);
    return;
  }

  if (!existsSync(snapshotPath)) fail(2, `${snapshotPath} missing — run rubric.mjs --snapshot ${snapshotPath} first; its guard_terms drive the export's guard hits.`);
  const effective = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
  const problems = validateSnapshot(effective);
  if (problems.length) fail(2, `${snapshotPath} is not a valid rubric snapshot: ${problems.join('; ')}`);
  const matchers = buildGuardMatchers(effective.guard_terms);

  const { rules, totalCount, pages, pageSize } = fetchAll(args.qodo, args.readArgs);

  const ids = new Set();
  for (const r of rules) {
    const key = String(r.ruleId);
    if (ids.has(key)) fail(2, `duplicate ruleId ${r.ruleId} across pages; fetched ${rules.length}, totalCount ${totalCount}. Nothing written.`);
    ids.add(key);
  }
  if (rules.length !== totalCount) fail(2, `fetched ${rules.length} rules but totalCount is ${totalCount} (${pages} pages). Nothing written.`);

  // Batches are ordered by ruleId so the same workspace yields the same batch files.
  const ordered = [...rules].sort((a, b) => compareRuleIds(a.ruleId, b.ruleId));
  mkdirSync(batchesDir, { recursive: true });
  for (const stale of batchFiles(batchesDir, true)) unlinkSync(join(batchesDir, stale));
  const exportedAt = new Date().toISOString();
  let guardHitRules = 0;
  let batchCount = 0;
  for (let i = 0; i < ordered.length; i += BATCH_SIZE) {
    batchCount++;
    const slice = ordered.slice(i, i + BATCH_SIZE).map((r) => {
      const hits = guardHits(r, matchers);
      if (hits.length) guardHitRules++;
      return { ruleId: r.ruleId, name: r.name, category: r.category, severity: r.severity, content: r.content, guard_hits: hits };
    });
    const name = `batch-${String(batchCount).padStart(3, '0')}.json`;
    writeFileSync(join(batchesDir, name), `${JSON.stringify({ run_id: runId, batch: batchCount, rules: slice }, null, 1)}\n`);
    writeFileSync(join(batchesDir, name.replace(/\.json$/, '.txt')), renderBatchText(runId, batchCount, slice));
  }

  const tmp = `${exportPath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ run_id: runId, exported_at: exportedAt, totalCount, rules }, null, 1)}\n`);
  renameSync(tmp, exportPath);

  process.stdout.write(`${JSON.stringify({
    run_id: runId,
    status: 'exported',
    totalCount,
    exported: rules.length,
    pages,
    page_size: pageSize,
    batches: batchCount,
    batch_size: BATCH_SIZE,
    guard_hit_rules: guardHitRules,
    guard_terms: effective.guard_terms,
    export: exportPath,
    batches_dir: batchesDir,
  })}\n`);
}

main();
