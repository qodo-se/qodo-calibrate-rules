# qodo-standards-calibrate

Version 0.6.2 of this coding-agent skill turns a workspace-wide severity review into one
reviewable, resumable batch. It checks the CLI version, authentication, workspace admin
permission, and the tool catalog; creates an editable rubric file on first run; exports every
active Qodo Review Standards rule into a local run folder; classifies each rule against a fixed
rubric (one taxonomy tag and a proposed severity per rule, with keyword-guard
and platform-category vetoes on decreases) in parallel classifier subagents so the orchestrating
agent never loads rule text; renders a diff-only proposal checklist grouped by
direction and tag; reads the admin's edits back as approve, skip, or override with invalid values
reported by row; and, after an explicit confirmation, applies the approved rows as a single
generated script, writing a per-row receipt and remembering every decision so a later run does
not ask twice. **`severity` is the only field it ever writes**, one rule at a time, with an
idempotency key per row and a receipt an interrupted run resumes from. Verifying the applied rows
and reverting a run from its receipt arrive in a later version. Changing a single rule's severity
is not this skill's job — use `qodo-manage-standards` for that.

## How a run goes

1. **Preflight** — CLI version, login, admin permission, tool catalog.
2. **Rubric** — `rubric.yaml` on first run, pinned into the run as a snapshot.
3. **Export** — every active rule into `export.json` plus 40-rule batches.
4. **Classify** — one taxonomy tag per rule, decided from the rule's full text by classifier
   subagents (1–2 batches each, in parallel, each in a fresh
   context); the rubric gives the proposed severity, and a keyword guard or a Security/Compliance
   category turns a proposed decrease into a row that needs a decision instead. The orchestrating
   agent reads only the scripts' status lines.
5. **Propose** — `proposal.md`: a markdown checklist, one row per changing rule with its id,
   name, `current → proposed`, any guard terms, and the portal link. Rows the rubric
   proposes start checked; guard or category conflicts start deferred (`[?]`). Unchanged rules never
   appear, and rules the admin already decided are held out and counted in the footer.
6. **Approve** — the admin edits the file in any editor (uncheck to skip, `[?]` to defer to the
   next run, edit the value after the arrow to override), or reviews it in the bundled browser page (`stage-review.mjs` writes a
   self-contained `review.html` into the run folder; approve / skip / override per row, bulk
   actions, keyboard flow, guard-term highlighting; *Commit decisions* downloads the edited
   `proposal.md`), and says when they are done. The skill reads it back — counts,
   invalid values by row, deleted rows — and asks for confirmation before writing anything. The
   rules they unchecked go into the ledger at this point; deferred rows are never recorded (and again when the loop is generated,
   so a missed step cannot lose them).
7. **Apply** — the confirmed decisions become `apply.sh`, one `qodo rules update` per approved
   row, run as a single shell invocation. Each row lands in `receipt.md` as `applied`,
   `failed(<code>)`, `deferred`, or `skipped`. An auth or permission error stops the loop before
   the next row; a rate limit (`MT-RATE-LIMITED`) or an upstream outage (`MT-UPSTREAM-DOWN`)
   retries the same row with exponential backoff five times and then marks it `deferred` for a
   later run. The run exits non-zero unless every approved row applied, and names each row that
   did not by id and code.
8. **Resume** — an interrupted apply is re-generated and re-run from the receipt: rows already
   `applied` are never attempted again, so no rule is written twice.
9. **Remember** — the skipped rules, and the rows that actually applied, go into
    `decisions.jsonl`. Saying "reconsider rule 815412" releases one so the next proposal includes
    it again.

> **Preview.** This repository is a preview distribution. The skill will move to the official
> Qodo Standards package (`qodo-standards`) once it is complete; at that point install and update
> through that package instead of this repository.

## Install

```sh
npx skills add <repo>@<tag> --skill qodo-standards-calibrate
```

Replace `<repo>` with this repository's URL and `<tag>` with the release tag you want. Add
`--agent <name>` for each local agent and `--global` to install for the user rather than the
current project, as with any skills.sh install. The skill lands as
`skills/qodo-standards-calibrate/SKILL.md` with its `scripts/` and `references/` beside it.

## Prerequisites

- This skill is installed from its preview repository (skills.sh) and loaded explicitly; it does
  not require the `qodo-standards` package.
- Qodo CLI `0.1.0-next.37` or newer, installed and logged in (`qodo login`). The skill probes
  `qodo --version` first and offers `qodo update` once if the runtime is older.
- Node.js 20 or newer. The bundled scripts use Node built-ins only — no npm install.
- Workspace admin permission (`owner` or `admin`). Severity changes are admin-gated on the
  platform; the skill stops with a plain message for anyone else.

## What it writes, and where

Everything lives under `${QODO_HOME:-$HOME/.qodo}/calibrate/`; nothing is written inside a
repository or the skill install directory.

- `rubric.yaml` — created from defaults on the first run and never overwritten. Edit it to
  override a tag's default severity (`severity_overrides`) or add words to the keyword guard
  (`guard_terms_extra`). The taxonomy, defaults, and guard list are documented in
  `skills/qodo-standards-calibrate/references/rubric.md`.
- `decisions.jsonl` — the decisions ledger: one appended line per decision, with the severity it
  settled on and a hash of the rule's text. Skips are recorded when the admin confirms; approvals
  and overrides are recorded only for rows that actually applied (a failed, deferred, or pending
  row is proposed again). A skip or override is honored while the rule's text is unchanged; an
  approval is honored while the rule still sits at the approved severity, so a severity that
  drifts later is re-proposed. "reconsider rule <id>" releases one.
- `runs/<run-id>/` (`run-id` = `YYYYMMDD-HHMMSS` UTC) — one folder per run: `export.json` (every
  active rule as returned by the CLI), `batches/batch-NNN.json` (40 rules each, with precomputed
  guard hits) beside `batch-NNN.txt` (the same rules as plain text, what a classifier reads), `rubric-snapshot.yaml` (the effective rubric this
  run used), `classification.jsonl` (append-only, one line per rule per recording: tag,
  current and proposed severity, direction, guard hits, and whether the row needs an admin
  decision; the last line per rule wins, so parallel classifiers never conflict), `proposal.md` (the checklist the admin edits), `receipt.md` (that checklist plus a status
  token per row and the apply's exit code), `apply.sh` (the generated loop that was executed, kept
  for audit), and `apply-results.jsonl` (every attempt, appended). Re-running in the same folder
  resumes at the first unclassified batch or the first unapplied row; `proposal.md` is never
  modified by the apply step and never overwritten without an explicit `--replace`.

The receipt grammar, the apply script's shape, the failure policy, the exit codes, and the resume
rules are documented in `skills/qodo-standards-calibrate/references/receipt-format.md`.

**Windows.** `apply.sh` is POSIX `sh`. Run it under **Git Bash** or **WSL**; there is no
PowerShell equivalent. The rest of the workflow runs in PowerShell, but pass JSON arguments
through `--tags-file` rather than inline single quotes.

## License

MIT — see [LICENSE](LICENSE).
