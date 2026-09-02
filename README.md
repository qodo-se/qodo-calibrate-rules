# qodo-standards-calibrate

Version 0.2.0 of this coding-agent skill runs read-only against the Qodo CLI: it checks the CLI
version, authentication, workspace admin permission, and the tool catalog; creates an editable
rubric file on first run; exports every active Qodo Review Standards rule into a local run folder;
classifies each rule against a fixed rubric (one taxonomy tag and a proposed severity per rule,
with keyword-guard and platform-category vetoes on decreases); and stops with counts. It changes
nothing in the workspace. It is the second step toward a skill that calibrates the severity of
every active rule across a workspace as one reviewable, reversible batch. Later versions add the
rest of the workflow: render a diff-only proposal checklist, let the workspace admin approve, skip,
or override row by row, apply only the approved rows, verify the result, and revert a run from its
receipt when needed. Changing a single rule's severity is not this skill's job — use
`qodo-manage-standards` for that.

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
- `runs/<run-id>/` (`run-id` = `YYYYMMDD-HHMMSS` UTC) — one folder per run: `export.json` (every
  active rule as returned by the CLI), `batches/batch-NNN.json` (40 rules each, with precomputed
  guard hits), `rubric-snapshot.yaml` (the effective rubric this run used), and
  `classification.json` (one row per rule: tag, current and proposed severity, direction, guard
  hits, and whether the row needs an admin decision). Re-running in the same folder resumes at
  the first unclassified batch.

## License

MIT — see [LICENSE](LICENSE).
