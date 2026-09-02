# qodo-standards-calibrate

Version 0.1.0 of this coding-agent skill runs a read-only preflight against the Qodo CLI: it
checks the CLI version, authentication, workspace admin permission, and the tool catalog, reports
the outcome, and stops without writing anything. It is the scaffold for a skill that will
calibrate the severity of every active Qodo Review Standards rule across a workspace as one
reviewable, reversible batch. The planned workflow of later versions is: export the active rules
through the CLI, classify each against a fixed rubric, propose a severity per rule, let the
workspace admin approve, skip, or override row by row, apply only the approved rows, verify the
result, and revert a run from its receipt when needed. Changing a single rule's severity is not
this skill's job — use `qodo-manage-standards` for that.

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
`skills/qodo-standards-calibrate/SKILL.md`.

## Prerequisites

- This skill is installed from its preview repository (skills.sh) and loaded explicitly; it does
  not require the `qodo-standards` package.
- Qodo CLI `0.1.0-next.37` or newer, installed and logged in (`qodo login`). The skill probes
  `qodo --version` first and offers `qodo update` once if the runtime is older.
- Workspace admin permission (`owner` or `admin`). Severity changes are admin-gated on the
  platform; the skill stops with a plain message for anyone else.

## License

MIT — see [LICENSE](LICENSE).
