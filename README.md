# qodo-standards-calibrate

Version 0.3.0 of this coding-agent skill runs read-only against the Qodo CLI: it checks the CLI
version, authentication, workspace admin permission, and the tool catalog; creates an editable
rubric file on first run; exports every active Qodo Review Standards rule into a local run folder;
classifies each rule against a fixed rubric (one taxonomy tag and a proposed severity per rule,
with keyword-guard and platform-category vetoes on decreases); renders a diff-only proposal
checklist grouped by direction and tag; reads the admin's edits back as approve, skip, or
override with invalid values reported by row; and, after an explicit confirmation, remembers the
rules the admin skipped so a later run does not propose them again. It changes nothing in the
workspace — no rule's severity is written yet. Later versions add the rest of the workflow: apply
the approved rows, verify the result, and revert a run from its receipt when needed. Changing a
single rule's severity is not this skill's job — use `qodo-manage-standards` for that.

## How a run goes

1. **Preflight** — CLI version, login, admin permission, tool catalog.
2. **Rubric** — `rubric.yaml` on first run, pinned into the run as a snapshot.
3. **Export** — every active rule into `export.json` plus 40-rule batches.
4. **Classify** — one taxonomy tag per rule; the rubric gives the proposed severity, and a
   keyword guard or a Security/Compliance category turns a proposed decrease into a row that
   needs a decision instead.
5. **Summarize** — a one-line, agent-written summary of each rule that will appear in the
   proposal, written from the rule's full text.
6. **Propose** — `proposal.md`: a markdown checklist, one row per changing rule with its id,
   name, summary, `current → proposed`, any guard terms, and the portal link. Rows the rubric
   proposes start checked; guard or category conflicts start unchecked. Unchanged rules never
   appear, and rules the admin already decided are held out and counted in the footer.
7. **Approve** — the admin edits the file in any editor (uncheck to skip, edit the value after
   the arrow to override) and says when they are done. The skill reads it back — counts,
   invalid values by row, deleted rows — and asks for confirmation before recording anything.
8. **Remember** — the skipped rules go into `decisions.jsonl`. Saying "reconsider rule 815412"
   releases one so the next proposal includes it again.

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
- `decisions.jsonl` — the decisions ledger: one appended line per rule the admin skipped, with
  the severity they decided on and a hash of the rule's text. A skip is honored while the rule's
  text is unchanged, so the rule is not proposed again until it is edited in the portal or
  released with "reconsider rule <id>". Nothing is appended before the admin confirms, and this
  version records **skips only** — entries for the rows they approved or overrode are written
  when those changes are applied, in a later version, and those are the ones re-proposed if the
  severity later drifts.
- `runs/<run-id>/` (`run-id` = `YYYYMMDD-HHMMSS` UTC) — one folder per run: `export.json` (every
  active rule as returned by the CLI), `batches/batch-NNN.json` (40 rules each, with precomputed
  guard hits), `rubric-snapshot.yaml` (the effective rubric this run used),
  `classification.json` (one row per rule: tag, current and proposed severity, direction, guard
  hits, and whether the row needs an admin decision), `summaries.json` (the one-line summary per
  rule), and `proposal.md` (the checklist the admin edits, which becomes the record of their
  decisions). Re-running in the same folder resumes at the first unclassified batch; the
  proposal is never overwritten without an explicit `--replace`.

## License

MIT — see [LICENSE](LICENSE).
