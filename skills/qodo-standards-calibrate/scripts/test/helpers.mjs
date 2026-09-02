import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TEST_DIR = dirname(fileURLToPath(import.meta.url));
export const SCRIPTS_DIR = join(TEST_DIR, '..');
export const SKILL_DIR = join(SCRIPTS_DIR, '..');
export const FAKE_QODO = join(TEST_DIR, 'fake-qodo.mjs');
export const EXPORT = join(SCRIPTS_DIR, 'export-rules.mjs');
export const RUBRIC = join(SCRIPTS_DIR, 'rubric.mjs');
export const RECORD = join(SCRIPTS_DIR, 'record-batch.mjs');

export function tmp(prefix = 'calibrate-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

// Runs a script with node; the environment never points at the real ~/.qodo.
export function run(script, args, { env = {}, cwd } = {}) {
  const res = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    cwd,
    env: { ...process.env, QODO_HOME: env.QODO_HOME ?? tmp('qodo-home-'), ...env },
  });
  let json = null;
  try { json = JSON.parse(res.stdout.trim().split('\n').pop()); } catch { /* not JSON */ }
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, json };
}

// A run dir with a pinned rubric snapshot; optional rubric.yaml content.
export function makeRun(rubricYaml = null) {
  const base = tmp();
  const runDir = join(base, 'runs', '20260101-000000');
  mkdirSync(runDir, { recursive: true });
  const rubricPath = join(base, 'rubric.yaml');
  if (rubricYaml !== null) writeFileSync(rubricPath, rubricYaml);
  const res = run(RUBRIC, ['--rubric', rubricPath, '--snapshot', join(runDir, 'rubric-snapshot.yaml')]);
  if (res.status !== 0) throw new Error(`rubric setup failed: ${res.stderr}`);
  return { base, runDir, rubricPath, rubric: res.json };
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function writeBatch(runDir, n, rules) {
  mkdirSync(join(runDir, 'batches'), { recursive: true });
  writeFileSync(join(runDir, 'batches', `batch-${String(n).padStart(3, '0')}.json`), JSON.stringify({ run_id: 'test', batch: n, rules }));
}

export function pageLog(path) {
  try { return readFileSync(path, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).map((o) => [o.page, o.size]); } catch { return []; }
}
