# Changelog

All notable changes to this skill. Versions are the skill's own `metadata.version`, which is also
stamped into every generated `apply.sh` / `revert.sh` header.

## 0.8.0

- **Renamed** from `qodo-standards-calibrate` to `qodo-calibrate-rules`. The skill directory, the
  `name:` in frontmatter, the `--skill` provenance flag, and the generated-script header brand all
  use the new name, so an existing install must be re-added under it. This is the breaking part of
  the release.
- **On-disk and platform contracts are unchanged.** The state directory is still
  `${QODO_HOME:-$HOME/.qodo}/calibrate/` (rubric, decisions ledger, and every run folder stay
  exactly where they were), and the idempotency keys are still `calibrate-<run-id>-<rule-id>` and
  `calibrate-revert-<run-id>-<rule-id>`. The `CALIBRATE_*` environment variables, the run-id
  format, the status-token vocabulary, and the exit codes are also untouched. Nothing in a
  previous run's state is orphaned by the rename.
- Documentation and test fixtures sanitized for public release. No behavior changed.
- Install is `npx skills add qodo-se/qodo-calibrate-rules -g -y`. `skills.sh` reads
  `<package>@<name>` as a **skill** selector, not a git ref, and offers no way to pin a tag, so
  these release tags mark the code but cannot be installed directly by tag.

## 0.7.0

- **Verify** — a read-only re-read of every active rule, paged the same way the export is,
  comparing each row's live severity against what the receipt expects and marking it `verified` or
  `mismatch(<actual>)` / `mismatch(missing)`. An `applied` row is no longer trusted without it.
- **Revert** — the apply loop run backwards from the receipt, under its own
  `calibrate-revert-<run-id>-<rule-id>` key, with `reverted` / `failed(revert:<code>)` per row. A
  reverted run is closed for apply, and no ledger entry is written.
- `apply-results.jsonl` lines carry `phase: apply | verify | revert`; the receipt frontmatter gains
  `verified_at`, `verify_mismatches`, `reverted_at`, and `revert_exit_code`.

## 0.6.2

- The browser hand-off resolves the download folder per shell, so the poll for the committed
  `proposal.md` looks in the right place.
- The wait loop is `find`-based, so zsh no longer prints `no matches found` on every tick.

## 0.6.1

- Every hand-off path the admin has to open — `proposal.md`, `review.html`, `receipt.md`, the run
  folder, the rubric, the ledger — is presented as a clickable `file://` link with the absolute
  path resolved.
- Classifiers are spawned in one turn and record their tags inline, with no cross-batch peeking.

## 0.6.0

- **Browser review page** — `stage-review.mjs` writes a self-contained `review.html` into the run
  folder: approve / skip / override per row, bulk actions, keyboard flow, guard-term highlighting,
  and a *Commit decisions* button that downloads the edited `proposal.md`.
- `[?]` **defers** a row to the next run instead of remembering it as a skip, and rows that need a
  decision render deferred so an untouched row is never recorded as a deliberate skip. The
  stage-review status line counts them.
- The per-row note field was dropped: only the decision is recorded.

## 0.5.0

- One-pass classification in parallel classifier subagents, `classification.jsonl` as an
  append-only record (last line per rule wins), and `batch-NNN.txt` plain-text batch views so a
  classifier reads text while the orchestrator only reads status lines.
- Rule summaries dropped from the proposal.

## 0.4.0

- **Apply** — the confirmed decisions become a single generated `apply.sh`, one
  `qodo rules update` per approved row under `calibrate-<run-id>-<rule-id>`, with a per-row
  receipt (`applied`, `failed(<code>)`, `deferred`, `skipped`), the abort / retry / fail policy,
  and **resume**: rows already `applied` are never attempted again.

## 0.3.0

- **Proposal** — a diff-only markdown checklist grouped by direction and tag, with the readback
  that parses the admin's edits as approve / skip / override and reports invalid values by row.
- **Decisions ledger** — `decisions.jsonl`, with `reconsider <id>` to release a held rule.

## 0.2.0

- **Export** of every active rule into a run folder plus 40-rule batches with precomputed guard
  hits, the **rubric** file (created from defaults on first run, snapshotted per run), and the
  classification taxonomy with its keyword-guard and platform-category vetoes on decreases.

## 0.1.0

- Skill scaffold and **preflight**: CLI version compatibility gate, authentication with provenance
  stamped on the first call, workspace admin permission, and the tool catalog check.
