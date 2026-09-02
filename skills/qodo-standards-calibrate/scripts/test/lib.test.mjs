import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildGuardMatchers, compareRuleIds, DEFAULT_GUARD_TERMS, guardHits, parseRubric, TAG_DEFAULTS, TAGS } from '../lib/calibrate-lib.mjs';
import { SKILL_DIR } from './helpers.mjs';

const hits = (text, terms = DEFAULT_GUARD_TERMS) => guardHits({ name: '', content: text }, buildGuardMatchers(terms));

test('guard stem matching', () => {
  assert.deepEqual(hits('Requires Authentication'), ['auth', 'authentic']);
  assert.deepEqual(hits('never leave deleted rows'), ['delete']);
  assert.deepEqual(hits('handles personal  data carefully'), ['personal data']);
  assert.deepEqual(hits('use the oauth flow'), []);
  assert.deepEqual(hits('written by the author'), []);
  assert.deepEqual(hits('Authored by'), []);
  assert.deepEqual(hits('AUTHORIZATION header'), ['auth', 'authoriz']);
  assert.deepEqual(hits('drop the dropdown'), ['drop']);
  assert.deepEqual(hits('a (secret) value'), ['secret']);
  assert.deepEqual(hits('name only', ['name only']), ['name only']);
  assert.deepEqual(guardHits({ name: 'Rotate Passwords', content: '' }, buildGuardMatchers(DEFAULT_GUARD_TERMS)), ['password']);
});

test('ruleId ordering is numeric-aware', () => {
  assert.deepEqual([10, 9, 100, 1].sort(compareRuleIds), [1, 9, 10, 100]);
  assert.deepEqual(['r10', 'r9', 'r100'].sort(compareRuleIds), ['r9', 'r10', 'r100']);
});

test('taxonomy includes architecture at warning and has 13 tags', () => {
  assert.equal(TAGS.length, 13);
  assert.equal(TAG_DEFAULTS.architecture, 'warning');
  assert.ok(TAGS.indexOf('architecture') > TAGS.indexOf('api-contract'));
});

test('references/rubric.md and rubric-defaults.yaml agree with the code taxonomy', () => {
  const md = readFileSync(join(SKILL_DIR, 'references', 'rubric.md'), 'utf8');
  const yaml = readFileSync(join(SKILL_DIR, 'references', 'rubric-defaults.yaml'), 'utf8');
  for (const [tag, sev] of Object.entries(TAG_DEFAULTS)) {
    assert.match(md, new RegExp(`^\\| \`${tag}\` \\| ${sev} \\|`, 'm'), `rubric.md row for ${tag}`);
    assert.match(yaml, new RegExp(`^#   ${tag.replace(/-/g, '\\-')}\\s+${sev}\\s`, 'm'), `rubric-defaults.yaml line for ${tag}`);
  }
  for (const term of DEFAULT_GUARD_TERMS) assert.ok(md.includes(`\`${term}\``), `rubric.md guard term ${term}`);
  const parsed = parseRubric(yaml, 'rubric-defaults.yaml');
  assert.deepEqual(parsed, { version: 1, severity_overrides: {}, guard_terms_extra: [] });
});
