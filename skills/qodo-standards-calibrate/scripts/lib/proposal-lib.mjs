// proposal-lib.mjs — the proposal row grammar as code: render it, parse it back, group it into
// sections, and validate the agent-written summaries. Node built-ins only.
//
// Row grammar (references/proposal-format.md is the human-readable copy):
//
//   - [x] <rule_id> · <name> · <summary> · <current> → <target> · [guard: <terms> ·] <url>
//
// Only the checkbox, the rule id, and the target are decisions. The name/summary middle is
// opaque, which is why parsing is right-anchored: an edited or odd name never shifts a field.
// Current is opaque too, so a rule sitting at a severity this skill does not know ("critical")
// renders and parses; the reader compares it against the classification row instead.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { compareRuleIds, parseSnapshot, SEVERITIES, TAGS, validateSnapshot } from './calibrate-lib.mjs';

export const TITLE = '# Qodo Standards Calibration — proposal';
export const SUMMARY_MAX = 160;

// Both severities are \S+ on purpose: an edited "critical" target parses and is reported as an
// invalid override rather than a mangled row, and a rule whose current severity is not one of
// the three (recorded as needs-a-decision) can still be rendered and decided.
export const ROW_RE = /^- \[( |x|X)\] (\d+) · (.+) · (\S+) → (\S+)(?: · guard: ([^·]+))? · (\S+)\s*$/;

export class RunError extends Error {
  constructor(message, code = 2) {
    super(message);
    this.name = 'RunError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------------------
// Summaries

export function hasSummary(summaries, ruleId) {
  const s = summaries?.[String(ruleId)];
  return typeof s === 'string' && s.trim().length > 0;
}

// The exported rule's raw content is what a summary is written from and what the ledger hashes.
export function hasContent(rule) {
  return Boolean(rule) && typeof rule.content === 'string';
}

export function validateSummary(summary) {
  if (typeof summary !== 'string') return 'summary must be a string';
  if (/[\r\n]/.test(summary)) return 'summary contains a newline';
  const s = summary.trim();
  if (!s) return 'summary is empty';
  if (s.length > SUMMARY_MAX) return `summary is ${s.length} characters (max ${SUMMARY_MAX})`;
  if (s.includes(' · ')) return 'summary contains the field separator " · "';
  if (s.includes('→')) return 'summary contains "→"';
  if (s.includes('…') || s.includes('...')) return 'summary contains a truncation mark';
  return null;
}

// ---------------------------------------------------------------------------------------
// Render

export function ruleUrl(rule, ruleId) {
  const url = rule && typeof rule.url === 'string' ? rule.url.trim() : '';
  return url || `https://app.qodo.ai/rules/${ruleId}`;
}

// A row is one line: a newline anywhere in the name or summary collapses to a single space.
export function oneLine(value) {
  return String(value ?? '').replace(/\s*\r?\n\s*/g, ' ');
}

export function renderRow(row) {
  const guard = Array.isArray(row.guard_hits) && row.guard_hits.length ? ` · guard: ${row.guard_hits.join(', ')}` : '';
  return `- [${row.checked ? 'x' : ' '}] ${row.rule_id} · ${oneLine(row.name)} · ${oneLine(row.summary)} · ${row.current} → ${row.target}${guard} · ${row.url}`;
}

// Sections: one per (direction, tag) pair that has rows — decreases first, then increases,
// taxonomy order within a direction, rows by numeric id — then the needs-a-decision section.
// Pre-checked and unchecked rows never share a section.
export function buildSections(displayRows) {
  const byId = (a, b) => compareRuleIds(a.rule_id, b.rule_id);
  const sections = [];
  for (const kind of ['decrease', 'increase']) {
    for (const tag of TAGS) {
      const rows = displayRows.filter((r) => !r.needs_decision && r.direction === kind && r.tag === tag).sort(byId);
      if (rows.length) sections.push({ kind, tag, target: rows[0].target, rows });
    }
  }
  const decisions = displayRows.filter((r) => r.needs_decision).sort(byId);
  if (decisions.length) sections.push({ kind: 'needs_decision', tag: null, target: null, rows: decisions });
  return sections;
}

export function sectionHeading(section) {
  if (section.kind === 'needs_decision') {
    return `## Needs a decision — guard or category conflict (${section.rows.length}) — check to approve`;
  }
  const label = section.kind === 'decrease' ? 'Decrease' : 'Increase';
  return `## ${label} → ${section.target} · ${section.tag} (${section.rows.length}) — pre-checked; uncheck to skip`;
}

export function heldFooter(heldCount) {
  return `Held by prior decision: ${heldCount} rules (say "reconsider rule <id>" to release one)`;
}

function blockScalar(text) {
  return String(text ?? '')
    .replace(/\s+$/, '')
    .split(/\r?\n/)
    .map((l) => (l.length ? `  ${l}` : ''))
    .join('\n');
}

export function renderProposal({ run_id, workspace_id, rule_count, proposed, held_by_prior_decision, rubric, sections }) {
  const out = [
    '---',
    `run_id: ${run_id}`,
    `workspace_id: ${workspace_id}`,
    `rule_count: ${rule_count}`,
    `proposed: ${proposed}`,
    `held_by_prior_decision: ${held_by_prior_decision}`,
    'rubric: |',
    blockScalar(rubric),
    '---',
    '',
    TITLE,
    '',
  ];
  for (const section of sections) {
    out.push(sectionHeading(section));
    for (const row of section.rows) out.push(renderRow(row));
    out.push('');
  }
  out.push('---', heldFooter(held_by_prior_decision), '');
  return out.join('\n');
}

// ---------------------------------------------------------------------------------------
// Parse

export function parseRow(line, lineNo = null) {
  const m = ROW_RE.exec(line);
  if (!m) return { line: lineNo, raw: line, ok: false, rule_id: null, reason: 'unparseable row' };
  return {
    line: lineNo,
    raw: line,
    ok: true,
    checked: m[1] !== ' ',
    rule_id: Number(m[2]),
    middle: m[3],
    current: m[4],
    target: m[5],
    guard_hits: m[6] ? m[6].split(',').map((t) => t.trim()).filter(Boolean) : [],
    url: m[7],
  };
}

// Only these frontmatter keys are numbers; run_id and workspace_id stay strings whatever they
// look like (a run id of all digits must not become a Number).
const NUMERIC_KEYS = Object.freeze(['rule_count', 'proposed', 'held_by_prior_decision']);

// Frontmatter of proposal.md: flat `key: value` lines plus the `rubric: |` block scalar.
// `error` is 'missing' when there is no leading `---` and 'unterminated' when the closing one
// is gone, so the caller can say which instead of reporting a run_id mismatch.
export function parseFrontmatter(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return { frontmatter: {}, endLine: 0, error: 'missing' };
  const frontmatter = {};
  let block = null;
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === '---' && !/^\s/.test(raw)) return { frontmatter, endLine: i + 1, error: null };
    if (block !== null) {
      if (/^\s/.test(raw) || !raw.trim()) {
        frontmatter[block] = `${frontmatter[block]}${raw.replace(/^ {2}/, '')}\n`;
        continue;
      }
      block = null;
    }
    const m = raw.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!m) continue;
    if (m[2].trim() === '|' || m[2].trim() === '|-') {
      block = m[1];
      frontmatter[block] = '';
      continue;
    }
    const value = m[2].trim();
    frontmatter[m[1]] = NUMERIC_KEYS.includes(m[1]) && /^\d+$/.test(value) ? Number(value) : value;
  }
  return { frontmatter, endLine: lines.length, error: 'unterminated' };
}

// Every line that looks like a checklist row, with its 1-based line number. Headings, the
// footer, and prose are ignored; a row whose checkbox is gone is simply not a row (the readback
// reports it as removed).
export function parseProposal(text) {
  const { frontmatter, endLine, error } = parseFrontmatter(text);
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const rows = [];
  for (let i = endLine; i < lines.length; i++) {
    const line = lines[i];
    if (!/^- \[/.test(line)) continue;
    rows.push(parseRow(line, i + 1));
  }
  return { frontmatter, rows, error };
}

// ---------------------------------------------------------------------------------------
// Run folder

export function isRendered(row) {
  return Boolean(row.needs_decision) || row.direction !== 'none';
}

// A needs-a-decision row is proposed at the rubric's severity for its tag — the value the veto
// took away. Rows recorded before rubric_proposed existed fall back to the run's snapshot.
export function targetFor(row, snapshot) {
  if (!row.needs_decision) return row.proposed;
  return row.rubric_proposed || snapshot?.severities?.[row.tag] || row.proposed;
}

function readJson(path, what) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new RunError(`${what} ${path} is not valid JSON (${e.message})`);
  }
}

export function listBatches(runDir) {
  const dir = join(runDir, 'batches');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((f) => f.match(/^batch-(\d{3})\.json$/))
    .filter(Boolean)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
}

// Everything the proposal and the readback need from a run folder, validated once.
export function loadRun(runDir) {
  const classificationPath = join(runDir, 'classification.json');
  if (!existsSync(classificationPath)) throw new RunError(`${classificationPath} missing — classify the batches first (record-batch.mjs --status)`);
  const rows = readJson(classificationPath, 'classification file');
  if (!Array.isArray(rows)) throw new RunError(`${classificationPath} must be a JSON array of rows`);
  if (rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
    throw new RunError(`${classificationPath} has an entry that is not a classification row — fix or remove the file and re-record the batches`);
  }

  const snapshotPath = join(runDir, 'rubric-snapshot.yaml');
  if (!existsSync(snapshotPath)) throw new RunError(`${snapshotPath} missing — this run has no pinned rubric`);
  const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
  const problems = validateSnapshot(snapshot);
  if (problems.length) throw new RunError(`${snapshotPath} is not a valid rubric snapshot: ${problems.join('; ')}`);
  const rubricText = readFileSync(snapshotPath, 'utf8');

  const exportPath = join(runDir, 'export.json');
  if (!existsSync(exportPath)) throw new RunError(`${exportPath} missing — export the rules first (export-rules.mjs)`);
  const exported = readJson(exportPath, 'export file');
  if (!exported || typeof exported !== 'object' || Array.isArray(exported)) {
    throw new RunError(`${exportPath} must be a JSON object with a rules array — re-run export-rules.mjs`);
  }
  const rules = new Map();
  for (const rule of Array.isArray(exported.rules) ? exported.rules : []) rules.set(String(rule.ruleId), rule);

  const summariesPath = join(runDir, 'summaries.json');
  let summaries = {};
  if (existsSync(summariesPath)) {
    summaries = readJson(summariesPath, 'summaries file');
    if (!summaries || typeof summaries !== 'object' || Array.isArray(summaries)) throw new RunError(`${summariesPath} must be a JSON object {"<ruleId>": "<summary>"}`);
  }

  const batches = listBatches(runDir);
  const done = [...new Set(rows.map((r) => r.batch))];
  return {
    runDir,
    runId: basename(runDir),
    rows,
    rules,
    summaries,
    summariesPath,
    snapshot,
    rubricText,
    batches,
    batchesRemaining: batches.filter((b) => !done.includes(b)),
    totalCount: Number.isFinite(exported.totalCount) ? exported.totalCount : rules.size,
  };
}
