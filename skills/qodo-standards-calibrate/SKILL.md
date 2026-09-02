---
name: qodo-standards-calibrate
description: Calibrate the severity of every active Qodo Review Standards rule across the workspace as one reviewable, reversible batch — export the active rules, propose a severity per rule from a fixed rubric, let the workspace admin approve or override each row, then apply only what was approved — using the qodo CLI's managed rules tools. Use on "calibrate our rule severities", "recalibrate review standards", "re-level the rules", "too many rules are errors", "bulk severity review", "which rules should be errors vs warnings"; skip changing one rule's severity or any single-rule edit (use qodo-manage-standards), reading or applying rules while coding (use qodo-get-rules), and anything that isn't workspace-wide severity calibration.
owner: Qodo
metadata:
  vendor: qodo
  version: "0.3.0"
  recommended: "false"
  package: "qodo-standards"
  distribution: "skills-sh"
---

# Calibrate Review Standards Severity

## Description

Use the `qodo` CLI to **calibrate** the severity of the workspace's Review Standards as one
reviewable, reversible batch: export every active rule, propose a severity per rule from a fixed
rubric, let the workspace admin approve or override each row, apply only what was approved, and
verify the result. Review Standards is Qodo's umbrella term for rules and suggestions. This skill
is the workspace-wide counterpart to `qodo-manage-standards`: changing one rule's severity ("make
the X rule an error") belongs there; re-levelling many rules at once belongs here. Reading and
applying rules while coding belongs to `qodo-get-rules`.

**This version implements preflight, rubric, export, classification, the proposal, and the
approval readback.** It confirms the runtime, authentication, admin permission, and tool catalog;
creates the admin's rubric file on first run; exports every active rule into a run folder;
assigns one taxonomy tag and a proposed severity to each rule; renders a diff-only checklist the
admin edits; reads their decisions back; and, after explicit confirmation, records the rules they
skipped so a later run does not re-propose them. Apply, verify, and revert arrive in a later
version. It issues no write to the workspace — no rule's severity changes yet.

## Prerequisites

- This skill is installed from its preview repository (skills.sh) and loaded explicitly.
- The Qodo CLI (0.1.0-next.37 or newer) is installed and authenticated.
- Node.js 20 or newer on PATH (the CLI itself needs it; the bundled scripts use built-ins only).
- The user is an admin (`owner` or `admin`) of the workspace whose rules will be calibrated.

## Instructions

Follow the workflow below in order: preserve update notices, resolve the executable, pass the
compatibility gate, confirm authentication with provenance stamped on the first call, confirm admin
permission, confirm the tool catalog, then run the rubric, export, classify, summarize, propose,
and approve phases and report the verified outcome. The provenance flags (`--skill`, `--skill-version`, `--distribution`) go on
the first authenticated call — `qodo read whoami` — only; every other command runs without them.
Every Qodo command in this version is read-only; the only files written live under
`${QODO_HOME:-$HOME/.qodo}/calibrate/`. Stop at the first failed step with the plain message for
that step.

`<skill-dir>` below is the directory containing this SKILL.md; its `scripts/` and `references/`
folders ship with the skill. `<launcher>` is the resolved `qodo` executable from the fallback below.

## Handle a skill update notice

A Qodo command can emit `QODO_NOTICE <json>` to stderr while still succeeding. When
`code` is `qodo_skill_update_available`, keep the command's result and finish the current
task. Then follow the notice's `steps`: do read-only inventory first, resolve the installed
Qodo package and scope, show the exact lifecycle-owner update command or UI action, and ask
once before any mutation. If the user declines, keep the current version usable.

Never invoke a different lifecycle owner, guess a placeholder, or install an optional package
implicitly. After an approved update, ask for the host restart named by the notice; the current
session may still have the old skill loaded.

## Runtime compatibility gate

First resolve the executable using the `qodo: command not found` fallback below. Before any other
Qodo command, run `<qodo> --version` exactly as shown, with no provenance flags.
This unadorned probe is intentionally compatible with older Qodo CLIs. This skill requires Qodo
CLI **0.1.0-next.37 or newer**.

If the version is older or cannot be parsed, do not run `whoami`, `login`, or a managed tool and
do not describe the failure as an authentication problem. Explain that the skill is newer than the
runtime, show `qodo update` as the update command for the runtime's already-recorded origin, and ask
once before running it. For a customer deployment, keep its organization-provided update origin;
never switch it to the public service. After an approved update, rerun the unadorned version probe
and continue only when it satisfies the minimum. If the user declines or the update fails, stop with
the current skill and user files unchanged.

Compare versions as semver: a prerelease `0.1.0-next.N` orders by N numerically (`next.100` is
newer than `next.37`), and a stable `0.1.0` counts as newer than any `0.1.0-next.N`.

## Quick start

```
qodo --version                                                      # compatibility probe — run this FIRST
qodo read whoami --json --skill qodo-standards-calibrate --skill-version 0.3.0 --distribution skills-sh
qodo tools --json                                                   # catalog must list rules-update, rules-list, rules-get, rules-metadata
qodo read tools rules --json                                        # exact safe flags (renders offline)
ls "${QODO_HOME:-$HOME/.qodo}/calibrate/runs/"                                      # an interrupted run to resume?
RUN="${QODO_HOME:-$HOME/.qodo}/calibrate/runs/$(date -u +%Y%m%d-%H%M%S)"            # new run id (skip when resuming)
node <skill-dir>/scripts/rubric.mjs --snapshot "$RUN/rubric-snapshot.yaml"          # new run only; creates rubric.yaml on first run
node <skill-dir>/scripts/export-rules.mjs --out "$RUN" --qodo <launcher>            # reads guard terms from the snapshot
node <skill-dir>/scripts/record-batch.mjs --run "$RUN" --status                       # which batches remain
node <skill-dir>/scripts/record-batch.mjs --run "$RUN" --batch 1 --tags '{"<ruleId>":"<tag>", ...}'
node <skill-dir>/scripts/proposal.mjs --run "$RUN" --summaries-needed --limit 20     # rows still missing a summary
node <skill-dir>/scripts/proposal.mjs --run "$RUN" --record-summaries '{"<ruleId>":"<one line>"}'
node <skill-dir>/scripts/proposal.mjs --run "$RUN" --summaries-file <path>          # same JSON from a file
node <skill-dir>/scripts/proposal.mjs --run "$RUN" --render --workspace-id <workspace_id>   # writes proposal.md
node <skill-dir>/scripts/approve.mjs --run "$RUN" --readback                        # counts + invalid rows; writes nothing
node <skill-dir>/scripts/approve.mjs --run "$RUN" --record-skips                    # only after the admin says yes
node <skill-dir>/scripts/ledger.mjs --show                                          # what earlier runs decided
node <skill-dir>/scripts/ledger.mjs --reconsider <ruleId>                           # release a held rule
```

PowerShell equivalent of the run-id line:
`$RUN = Join-Path $qodoHome "calibrate/runs/$((Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss'))"`.
Single-quoted JSON does not survive PowerShell quoting — on Windows, write the summaries chunk
and the tag map to a file and pass `--summaries-file` / `--tags-file` instead.

**`qodo: command not found`?** That's usually PATH, not a missing install: GUI-launched agents
run shells with a minimal PATH. On POSIX, retry `"${QODO_HOME:-$HOME/.qodo}/bin/qodo"`. In
Windows PowerShell, retry:

```powershell
$qodoHome = if ($env:QODO_HOME) { $env:QODO_HOME } else { Join-Path $HOME '.qodo' }
& (Join-Path $qodoHome 'bin/qodo.cmd')
```

Keep using the resolved launcher for every Qodo command here, and pass it to the export script as
`--qodo`. Only if it is missing is Qodo actually not installed; tell the user to obtain a
checksum-pinned installer command from Qodo or their organization's administrator. Installers are
served from https://get.qodo.ai, but never invent a digest or pipe an installer directly into a
shell.

**Sandbox auth diagnostic.** In a sandboxed environment, if `qodo read whoami` fails for any reason
(including `Not logged in`), ask the user to approve one exact read-only retry of `qodo read whoami`
outside the sandbox before recommending login or refreshing tools. Keychain failures can be
reported as generic auth failures, so the sandboxed result alone is not diagnostic. That approval
applies only to this single diagnostic retry: do not reuse it, request persistent approval, or move
later Qodo commands outside the sandbox automatically. If the retry succeeds, continue with normal
per-command permission checks. If it still fails, follow the normal auth troubleshooting below.

Add `--json` to everything you parse. **Confirm the exact tool names, flags, and write status with
`qodo read tools rules [<tool>] --json`** (renders offline from the cached catalog) — use it for reads;
inspect write commands with `qodo tools help rules [<tool>] --json`. The commands above are
illustrative, not guaranteed current; a stale catalog after a fresh install shows as `unknown
command`/`unknown option` on `rules` while `whoami` still succeeds — run `qodo tools --refresh`
and retry before assuming the tool doesn't exist.

## Preflight

1. **Auth first.** Run `qodo read whoami`. After the sandbox retry above when applicable, tell the user
   to run `qodo login` only when the result explicitly says `Not logged in`, then stop. `No tool
   catalog cached` is a catalog failure, not proof of missing credentials: run `qodo tools
   --refresh` once, then retry `whoami`. If either command still fails, report that exact failure
   and stop instead of sending the user through login. An `unknown command`/`unknown option` on
   `rules` while `whoami` succeeds also means a stale cached catalog — refresh once and retry.
2. **Admin gate.** Read `organization_permission` from the `whoami` JSON. Continue only when it is
   `owner` or `admin`. For any other value (for example `member`), stop before any further Qodo
   command and tell the user plainly: *"This requires admin permission in your workspace — ask an
   admin to make the change or grant you access."* Calibration changes rule severity, and that
   write is admin-gated on the platform, so there is nothing useful a non-admin can do here; do not
   continue to the catalog check, do not retry, and do not treat installation as evidence of
   authority. Compare the value case-insensitively. If the `whoami` output is not parseable JSON,
   or `organization_permission` is absent or has a value other than `owner`, `admin`, or a known
   non-admin role, report the exact output and stop — never infer permission. Keep `workspace_id`
   and `organization_permission` from the response for the outcome block; never invent a
   `workspace_id` — if it is absent, the outcome block says "workspace id not reported by whoami".
3. **Catalog check.** Run `qodo tools --json` and confirm that `rules-update`, `rules-list`,
   `rules-get`, and `rules-metadata` are listed. This version calls only `rules-list` (through the
   export script); the others are the tools later calibration steps use, and confirming them now
   surfaces a stale or incomplete catalog before any write exists. Take each tool's command path
   from the catalog's `command` field (and `readCommand` for the read tools) rather than trusting
   any command written in this file; the export script runs `rules-list` as
   `<launcher> read rules list …`, so confirm that matches the catalog's `readCommand`. If a tool
   is missing, or the `rules` commands answer `unknown command`/`unknown option` while `whoami`
   succeeded, run `qodo read tools rules --json` as the diagnostic (it renders offline from the
   cached catalog and shows exactly which `rules` tools the cache holds), then run
   `qodo tools --refresh` once and retry. If it still fails, report the exact failure and the
   diagnostic output, and stop.

## Rubric

The rubric — the fixed tag taxonomy, each tag's default severity, the platform-category prior, and
the keyword guard — is documented in `<skill-dir>/references/rubric.md`. Read it before
classifying. The admin's editable copy lives at `${QODO_HOME:-$HOME/.qodo}/calibrate/rubric.yaml`
(schema: `version: 1`, `severity_overrides` tag → severity, `guard_terms_extra` list; nothing else).

1. **Interrupted run?** List `${QODO_HOME:-$HOME/.qodo}/calibrate/runs/`. If it has folders, run
   `node <skill-dir>/scripts/record-batch.mjs --run <newest> --status`: when `batches_remaining`
   is non-empty (or `export.json` is missing), that run is unfinished — tell the user and resume
   it: reuse its folder, **skip step 2** (its `rubric-snapshot.yaml` already pins the rubric the
   recorded batches were classified under), and continue with Export and Classify. Otherwise mint
   a new run id `$(date -u +%Y%m%d-%H%M%S)` (PowerShell: see Quick start) and the run folder
   `${QODO_HOME:-$HOME/.qodo}/calibrate/runs/<run-id>/`.
2. **New run only.** Run `node <skill-dir>/scripts/rubric.mjs --snapshot <run-dir>/rubric-snapshot.yaml`.
   It honors `QODO_HOME`. On a first run it copies `<skill-dir>/references/rubric-defaults.yaml`
   to `rubric.yaml` and reports `"created": true` — tell the user the path, that the file is
   theirs to edit (override a tag's severity under `severity_overrides`, add guard words under
   `guard_terms_extra`), and that the next run picks up edits. Then continue. If the snapshot
   already exists the script refuses (exit 2) — that means you are in a resumed run: skip this
   step. Never pass `--replace-snapshot` on your own; it re-pins a run whose recorded batches were
   classified under the old rubric.
3. On every new run the script validates the file and merges it with the defaults. Exit code 2
   with a quoted line means the rubric is invalid: the message names the file, line, and the valid
   tags or severities. Show it verbatim and stop — no export, no classification — until the admin
   fixes the file.
4. On success the script prints JSON with `severities` (the effective tag → severity map),
   `guard_terms` (defaults plus `guard_terms_extra`), and `snapshot`. It has written the merged
   effective rubric verbatim to `<run-dir>/rubric-snapshot.yaml`; export and classify both read
   that snapshot, so the run is pinned to the rubric as it was when the run started.

## Export

Run the bundled script — one Bash invocation, read-only against the workspace:

```
node <skill-dir>/scripts/export-rules.mjs --out <run-dir> --qodo <launcher>
```

The script requires `<run-dir>/rubric-snapshot.yaml` and takes the guard terms from it (there is
no other guard-term input). It runs `<launcher> read rules list --state active --page-size 100
--page N --json`; if the catalog's `readCommand` for `rules-list` is anything other than
`qodo read rules list`, pass its tail as `--read-args "<words after qodo>"` — otherwise omit it.
Paging stops when the fetched count reaches the response's `totalCount` or a page comes back
empty; the count must then equal `totalCount`. Rules carry full examples, so a 100-rule page can
exceed the runtime's per-result byte cap; on the truncation marker the script halves the page size
(50, 25, …, never below 10) and continues from the rules already fetched. On `MT-RATE-LIMITED` (in
the JSON or on stderr) it waits 5 seconds and retries the page once. Any other failure, a count
mismatch, a page that pushes the count past `totalCount`, a duplicate id, a page that takes over
120 seconds, or a `totalCount` that changes mid-export ends the script with exit code 2, the
counts and the launcher's stderr tail in the message, and nothing written — report that message
and stop; do not classify.

On success (exit 0) it prints one JSON line (`totalCount`, `exported`, `pages`, `page_size`,
`batches`, `guard_hit_rules`) and has written:

- `<run-dir>/export.json` — `run_id`, `exported_at`, `totalCount`, and `rules` exactly as
  returned by the CLI (raw; never edit it). Written last, atomically, so a half-written export
  never exists.
- `<run-dir>/batches/batch-NNN.json` — the rules ordered by `ruleId` in batches of 40, each rule
  reduced to `ruleId`, `name`, `category`, `severity`, `content`, and `guard_hits` (the guard
  terms whose case-insensitive stem matched the name or content, precomputed).

A rule's portal URL is its `url` field when present, otherwise `https://app.qodo.ai/rules/<ruleId>`.
If `totalCount` is 0, the script writes an `export.json` with zero rules and no batch files; render
the outcome block saying there is nothing to calibrate and stop. If `export.json` already exists in
`<run-dir>` (a resumed run), the script leaves everything in place and reports `already_exported`;
if it exists but `batches/` is missing or empty, the script stops and tells you to remove
`export.json` to re-export — ask the user before deleting anything.

## Classify

Classification is your judgment, batch by batch; the arithmetic is the script's. Work only from
the batch files — never from `export.json` summaries and never from a rule's name alone.

1. Run `node <skill-dir>/scripts/record-batch.mjs --run <run-dir> --status`. It lists
   `batches_done` and `batches_remaining` from `<run-dir>/classification.json`. A re-run in the
   same run folder resumes at the first remaining batch; batches already present are skipped.
2. For each remaining batch, in order: read `batches/batch-NNN.json` **in full**. For every rule,
   read the whole `content` together with `name` and `category`, and assign exactly one tag from
   the taxonomy in `references/rubric.md`. When two tags fit, choose the one with the higher
   default severity (for example "never log tokens" is `secrets-handling`, not `logging`;
   "validate request bodies against the schema" is `security-control`, not `api-contract`).
   Common calls: type annotations and public signatures → `api-contract`; module boundaries,
   layering, dependency direction, allowed imports between components, "X must never import Y",
   "create charges only via the façade" → `architecture` (not `api-contract`); docstrings, comments,
   README/changelog → `documentation`; identifier or file naming → `naming`; formatter or linter
   output, whitespace, quotes → `style-formatting`; import grouping or unused imports →
   `import-order`; tests present, structured, deterministic → `test-hygiene`; exceptions, retries,
   timeouts, null handling → `error-handling`; log presence, levels, structure → `logging`;
   invariants whose violation gives wrong results → `correctness-contract`; authn/authz, input
   validation, injection, crypto → `security-control`; migrations, transactions, deletion,
   idempotency, backups → `data-integrity`; credentials, tokens, keys in code, config, or logs →
   `secrets-handling`. Long batch? Read it in parts — never skip one or tag from a skim.
3. Record the batch in one call, with a JSON object that maps every `ruleId` in the batch to its
   tag:
   `node <skill-dir>/scripts/record-batch.mjs --run <run-dir> --batch N --tags '{"815399":"documentation", …}'`
   (or `--tags-file <path>` for the same JSON). The script refuses the batch (exit 2) if any rule
   is missing, any id is not in the batch, or any tag is not in the taxonomy — fix the mapping and
   call it again; nothing was recorded. To correct a batch that is already recorded, add
   `--replace`; it drops only that batch's rows before recording the new ones.
4. The script derives the rest from `rubric-snapshot.yaml` and the batch file and appends one row
   per rule to `<run-dir>/classification.json` (a JSON array): `rule_id`, `name`, `category`,
   `current`, `tag`, `proposed`, `direction` (`decrease`|`increase`|`none`), `guard_hits`,
   `needs_decision`, `batch`. The derivation you are relying on:
   - `proposed` = the effective rubric's severity for the tag (default or admin override).
   - **Veto on decreases.** If `proposed` would be lower than `current` and either the rule has a
     guard hit or its tag's *default* severity is `recommendation` while its category is
     `Security` or `Compliance`, the row gets `needs_decision: true`, `proposed` set equal to
     `current`, and `direction: none`. Increases are never vetoed; a guard hit on a rule the
     rubric would raise or leave alone is recorded in `guard_hits` but does not set
     `needs_decision`. A rule whose current severity is not `error`/`warning`/`recommendation`
     is recorded as `needs_decision` with `proposed` equal to `current`.
   The file is rewritten atomically after each batch, so an interruption loses at most the batch
   in progress. The output line carries the batch's counts and the running totals.
5. After the last batch, run `--status` once more. `decrease`, `increase`, `unchanged`, and
   `needs_decision` are disjoint and sum to `rows`; `batches_remaining` must be empty before the
   proposal will render. Then continue with Summarize.

## Summarize

Every row that will appear in the proposal needs a one-line summary, written by you from the
rule's full `content`. The proposal refuses to render while one is missing.

1. `node <skill-dir>/scripts/proposal.mjs --run <run-dir> --summaries-needed --limit 20` lists
   the rules that still need one, each with `rule_id`, `name`, `tag`, and the full `content`.
   Only rows that will be rendered are listed: unchanged rules and rules held by a prior
   decision never are.
2. Write one sentence per rule from that content — what the rule requires — at most 160
   characters, on one line, with no ` · `, no `→`, and no `…`. It is display-only: never
   classify from a summary, and never paste a truncated slice of the content as one.
3. Record the chunk in one call, as a JSON object of rule id to summary:
   `node <skill-dir>/scripts/proposal.mjs --run <run-dir> --record-summaries '{"815399":"Every public function carries a docstring"}'`
   — one entry per rule in the chunk, or the same JSON in a file with `--summaries-file <path>`
   (the form to use on Windows). An invalid summary refuses the whole chunk, names the offending
   ids, and records nothing; a blank summary counts as missing. Chunks merge into
   `<run-dir>/summaries.json`; repeat steps 1–3 until `needed_total` is 0. A row listed under
   `missing_content` has no rule text in `export.json` — say so rather than inventing a summary.

## Propose

```
node <skill-dir>/scripts/proposal.mjs --run <run-dir> --render --workspace-id <workspace_id>
```

This writes `<run-dir>/proposal.md`: the diff-only checklist grouped by direction × tag, every
rubric-proposed row pre-checked, every needs-a-decision row unchecked, the run's rubric snapshot
in the frontmatter, and a footer counting the rules held by a prior decision. The grammar,
section wording, and frontmatter are in `<skill-dir>/references/proposal-format.md` — read it
before you explain the file, and never hand-write or hand-edit a row. Take `<workspace_id>` from
the `whoami` response; never invent one.

It refuses with exit 2 and writes nothing when the classification is incomplete (it names the
remaining batches), a rendered row has no summary (it lists the ids), or `proposal.md` already
exists. `--replace` overwrites it — ask the admin first, because their edits are discarded.

Then hand the file to the admin: the path, and that a checked row is approved, unchecking a row
skips it, editing the value after `→` is an override, and the needs-a-decision rows start
unchecked because a keyword guard or the rule's platform category contradicts the decrease. Ask
them to say when they are done. Do not edit the file for them.

## Approve

```
node <skill-dir>/scripts/approve.mjs --run <run-dir> --readback
```

The readback prints each row's decision plus `counts`, `invalid`, `removed`, and
`readback_text`. Show `readback_text` verbatim, name every invalid row by line number and reason
and say it is excluded, mention `removed` rows if there are any, then ask for explicit
confirmation. Nothing has been written at this point.

Only after the admin says yes: `node <skill-dir>/scripts/approve.mjs --run <run-dir> --record-skips`
appends their skipped rows to the decisions ledger, once per run (a second call reports
`already_recorded`). **The workflow stops there in this version.** Approvals and overrides are
not applied and not recorded; `qodo rules update`, `apply.sh`, and `receipt.md` belong to a later
version. Say so plainly rather than implying anything changed.

## Decisions ledger

`${QODO_HOME:-$HOME/.qodo}/calibrate/decisions.jsonl` remembers what the admin already decided,
so a second run does not ask twice. A rule is held out of the proposal while a skip or override
still matches its content hash, or an approve still matches its current severity; the footer
counts the held rules. `node <skill-dir>/scripts/ledger.mjs --show` prints the effective entry
per rule. When the admin says "reconsider rule 815412", run
`node <skill-dir>/scripts/ledger.mjs --reconsider 815412` and re-render with `--replace`; an id
with no entry is reported as nothing to release and nothing is written. Ledger semantics are in
`references/proposal-format.md`.

Release a rule **before** the admin starts editing the checklist, or on the next run. Re-rendering
mid-edit with `--replace` discards everything they have changed so far, so ask first and tell them
that is the cost; otherwise note the request and run it at the start of the next run.

## Report the verified outcome

After a read or mutation returns structured results, lead with one compact summary:

```
# 🛡️ Qodo Review Standards

**Outcome:** <what was found or changed>
**Scope:** <workspace or repository scopes involved>
**State:** <active, inactive, pending, rejected, or mixed counts>
---
```

Use the response's actual state and succeeded/matched counts; never turn a successful HTTP
response into a stronger claim. Render the block once per user-requested operation, not before
the confirmation gate and not for auth, permission, validation, or transport failures. Put rule
names, ids, before/after fields, dry-run details, and skipped items below it.

For this version the user-requested operation ends at the recorded decisions. Fill the block from
the render output and the readback, for example:

```
# 🛡️ Qodo Review Standards

**Outcome:** Exported <total_rules> active rules and classified all <rows> against the rubric, then proposed <rows-in-proposal> severity changes (<proposed> pre-checked · <needs_decision> needing a decision · <held_by_prior_decision> held by earlier decisions). Readback: <readback_text>. Recorded <recorded> skip decisions. Nothing was applied — no rule's severity changed; apply, verify, and revert arrive in a later version of this skill.
**Scope:** workspace <workspace_id>; run folder ~/.qodo/calibrate/runs/<run-id>/ (export.json, batches/, rubric-snapshot.yaml, classification.json, summaries.json, proposal.md); rubric ~/.qodo/calibrate/rubric.yaml (created this run | <n> overrides applied); ledger ~/.qodo/calibrate/decisions.jsonl
**State:** permission <organization_permission>; current severities: <current_counts.error> error · <current_counts.warning> warning · <current_counts.recommendation> recommendation
---
```

If the run stops at classification (the admin has not finished editing yet), report the
classification counts and the proposal path and say the decision is still open. For an empty
workspace, the Outcome line says the export found 0 active rules and there is nothing to
calibrate. Do not render the block when the CLI is missing or too old, when the user is not
logged in, when the admin gate fails, when the catalog check fails after one refresh, when the
rubric is invalid, or when a script exits non-zero — those stops get the plain message for that
step instead.

## Error Handling

- **Permission denied (admin required)** — severity changes are admin-gated. Explain plainly: *"This requires admin permission in your workspace — ask an
  admin to make the change or grant you access."* Don't retry; it won't succeed without a
  permission change.
- **Not installed** — both `qodo` and the `${QODO_HOME:-$HOME/.qodo}/bin/qodo` launcher are
  missing. Point the user to a checksum-pinned installer from Qodo or their administrator and stop.
- **Runtime too old or unparseable version** — handled by the compatibility gate above: explain,
  offer `qodo update` once, re-probe on accept, stop on decline or if still too old. Never run
  `whoami` on an old runtime.
- **Not logged in** — after the single sandbox diagnostic retry when applicable, tell the user to
  run `qodo login` and stop.
- **Stale catalog** — `unknown command`/`unknown option` on `rules`, or a required tool missing
  from `qodo tools --json`, while `whoami` works: `qodo tools --refresh` once, retry; if it still
  fails, report the exact failure and stop.
- **Invalid rubric** (`rubric.mjs` exit 2 with a quoted line) — quote the script's message (it
  names the file, line, and valid values) and stop before export. Never "fix" the admin's rubric
  yourself. Exit 2 saying the snapshot already exists means a resumed run: skip the rubric step.
- **Node.js too old** — every script checks for Node 20+ and prints a one-line message; ask the
  user to install a current Node.js (the Qodo CLI needs it too).
- **Short or failed export** (`export-rules.mjs` exit 2) — report the counts from stderr and stop;
  no classification. A `totalCount` that changed mid-run means rules were edited during export —
  re-run the script in the same run folder.
- **Rate limited (`MT-RATE-LIMITED`)** — the export script already waits 5 seconds and retries the
  page once; for any other command, do the same by hand. If still rate limited, report it and stop.
- **Batch refused** (`record-batch.mjs` exit 2) — the message lists every missing rule or invalid
  tag; complete the mapping and record the batch again.
- **Summary chunk refused** (`proposal.mjs` exit 2) — the message names each id and what is wrong
  (separator, arrow, truncation mark, length); nothing was recorded. Rewrite those summaries and
  record the chunk again.
- **Render refused** (`proposal.mjs --render` exit 2) — an incomplete classification (finish the
  named batches), a missing summary (record the listed ids), or an existing `proposal.md` (ask the
  admin before `--replace`). Nothing was written; do not work around it by writing the file
  yourself.
- **Readback refused** (`approve.mjs` exit 2) — no `proposal.md` yet, or its frontmatter `run_id`
  belongs to another run. Point at the right run folder; never edit the frontmatter to match.
- **Invalid or removed rows in the readback** (exit 0) — not a failure: report them by line number
  with the reason, say they are excluded, and let the admin fix the file and re-read it back.

## Guardrails

- **No Review Standards writes in this version.** Every Qodo command here (`--version`,
  `read whoami`, `tools --json`, `tools --refresh`, `read tools rules`, and `read rules list`
  inside the export script) leaves the workspace's rules untouched. Do not call `qodo rules update`
  or any other mutating tool, and do not generate `apply.sh` or write `receipt.md`. The only files
  written are `${QODO_HOME:-$HOME/.qodo}/calibrate/rubric.yaml` (first run only),
  `${QODO_HOME:-$HOME/.qodo}/calibrate/decisions.jsonl` (the ledger — skip entries after the
  admin confirms, `released` entries on a reconsider), and the run folder
  `${QODO_HOME:-$HOME/.qodo}/calibrate/runs/<run-id>/` (`export.json`, `batches/`,
  `rubric-snapshot.yaml`, `classification.json`, `summaries.json`, `proposal.md`) — plus the CLI's
  own catalog cache, which `qodo tools --refresh` refreshes as part of the mandated stale-catalog
  recovery. Write nothing into the skill install directory or inside a repository.
- **Nothing is recorded before the admin's explicit yes.** The readback writes nothing. The
  confirmation appends `skip` entries only; approvals and overrides are recorded after they are
  applied, which this version does not do. Never edit the admin's `proposal.md`, and never
  `--replace` it without asking.
- **Never fabricate a rule id, scope, or example.** Resolve or ask; an empty result from `list`
  is a valid outcome, not an error.
- **Classify from the full content.** Never tag a rule from its name or a summary, never skip a
  batch because it is long, and never edit `export.json` or a batch file.
- **Tell the user which outcome actually happened** — active rule vs. pending suggestion,
  matched vs. succeeded count from a bulk call — don't assume success from a 200 response alone.
- **Documented departure (forward reference).** Later versions apply approved severity changes as
  one batch: the admin's edited checklist plus a confirmed readback of its counts authorize the
  whole apply loop, instead of a confirmation before every write. This is a deliberate, documented
  departure from `qodo-manage-standards`'s confirm-before-every-write guardrail. It is limited to
  the calibration apply step, writes exactly one field (`severity`), records a per-row receipt that
  supports revert, and does not exist in this version.

Lead with the bottom line — what was proposed, what the admin decided, or what stopped the run
and why — then the specifics. A short, accurate status beats a wall of JSON.

Apply, verify, and revert follow in a later version of this skill.
