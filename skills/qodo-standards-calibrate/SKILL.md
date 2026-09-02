---
name: qodo-standards-calibrate
description: Calibrate the severity of every active Qodo Review Standards rule across the workspace as one reviewable, reversible batch — export the active rules, propose a severity per rule from a fixed rubric, let the workspace admin approve or override each row, then apply only what was approved — using the qodo CLI's managed rules tools. Use on "calibrate our rule severities", "recalibrate review standards", "re-level the rules", "too many rules are errors", "bulk severity review", "which rules should be errors vs warnings"; skip changing one rule's severity or any single-rule edit (use qodo-manage-standards), reading or applying rules while coding (use qodo-get-rules), and anything that isn't workspace-wide severity calibration.
owner: Qodo
metadata:
  vendor: qodo
  version: "0.4.0"
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

**This version implements preflight, rubric, export, classification, the proposal, the approval
readback, and apply with a resumable receipt.** It confirms the runtime, authentication, admin
permission, and tool catalog; creates the admin's rubric file on first run; exports every active
rule into a run folder; assigns one taxonomy tag and a proposed severity to each rule; renders a
diff-only checklist the admin edits; reads their decisions back; and, after explicit confirmation,
applies the approved rows as one batch, writing a per-row receipt and recording every decision in
the ledger. **Apply is the only write, and it writes only `severity`.** Verify and revert arrive
later.

## Prerequisites

- This skill is installed from its preview repository (skills.sh) and loaded explicitly.
- The Qodo CLI (0.1.0-next.37 or newer) is installed and authenticated.
- Node.js 20 or newer on PATH (the CLI itself needs it; the bundled scripts use built-ins only).
- The user is an admin (`owner` or `admin`) of the workspace whose rules will be calibrated.

## Instructions

Follow the workflow below in order: preserve update notices, resolve the executable, pass the
compatibility gate, confirm authentication with provenance stamped on the first call, confirm admin
permission, confirm the tool catalog, then run the rubric, export, classify, summarize, propose,
approve, and apply phases and report the verified outcome. The provenance flags (`--skill`,
`--skill-version`, `--distribution`) go on the first authenticated call — `qodo read whoami` —
only. Every phase before Apply is read-only against the workspace; Apply writes each approved
row's `severity` and nothing else, and every file written lives under
`${QODO_HOME:-$HOME/.qodo}/calibrate/`. Stop at the first failed step with its plain message.

`<skill-dir>` below is the directory containing this SKILL.md; its `scripts/` and `references/`
folders ship with the skill. `<launcher>` is the resolved `qodo` executable from the fallback below.

## Handle a skill update notice

A Qodo command can emit `QODO_NOTICE <json>` to stderr while still succeeding. When `code` is
`qodo_skill_update_available`, keep the command's result and finish the current task. Then follow
the notice's `steps`: read-only inventory first, resolve the installed Qodo package and scope, show
the exact lifecycle-owner update command or UI action, and ask once before any mutation. If the
user declines, keep the current version usable. Never invoke a different lifecycle owner, guess a
placeholder, or install an optional package implicitly. After an approved update, ask for the host
restart named by the notice; the current session may still have the old skill loaded.

## Runtime compatibility gate

First resolve the executable using the `qodo: command not found` fallback below. Before any other
Qodo command, run `<qodo> --version` exactly as shown, with no provenance flags.
This unadorned probe is intentionally compatible with older Qodo CLIs. This skill requires Qodo
CLI **0.1.0-next.37 or newer**.

If the version is older or cannot be parsed, do not run `whoami`, `login`, or a managed tool, and
do not describe the failure as an authentication problem. Explain that the skill is newer than the
runtime, show `qodo update` as the update command for the runtime's already-recorded origin, and
ask once before running it. For a customer deployment keep its organization-provided update origin;
never switch to the public service. After an approved update, rerun the unadorned probe and
continue only when it satisfies the minimum. If the user declines or the update fails, stop with
the current skill and user files unchanged.

Compare versions as semver: a prerelease `0.1.0-next.N` orders by N numerically (`next.100` beats
`next.37`), and a stable `0.1.0` counts as newer than any `0.1.0-next.N`.

## Quick start

```
qodo --version                                                      # compatibility probe — run this FIRST
qodo read whoami --json --skill qodo-standards-calibrate --skill-version 0.4.0 --distribution skills-sh
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
node <skill-dir>/scripts/apply.mjs --run "$RUN" --generate --qodo <launcher>        # writes receipt.md + apply.sh
sh "$RUN/apply.sh"                                                                  # ONE invocation applies the batch
node <skill-dir>/scripts/ledger.mjs --show                                          # what earlier runs decided
node <skill-dir>/scripts/ledger.mjs --reconsider <ruleId>                           # release a held rule
```

**Windows.** PowerShell run-id line:
`$RUN = Join-Path $qodoHome "calibrate/runs/$((Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss'))"`.
Single-quoted JSON does not survive PowerShell quoting — write the summaries chunk and the tag map
to a file and pass `--summaries-file` / `--tags-file`. `apply.sh` is POSIX `sh`: run it under Git
Bash or WSL, there is no PowerShell equivalent.

**`qodo: command not found`?** That's usually PATH, not a missing install: GUI-launched agents run
shells with a minimal PATH. On POSIX, retry `"${QODO_HOME:-$HOME/.qodo}/bin/qodo"`. In Windows
PowerShell, retry:

```powershell
$qodoHome = if ($env:QODO_HOME) { $env:QODO_HOME } else { Join-Path $HOME '.qodo' }
& (Join-Path $qodoHome 'bin/qodo.cmd')
```

Keep using the resolved launcher for every Qodo command, and pass it to the export and apply
scripts as `--qodo`. Only if it is missing is Qodo actually not installed: tell the user to obtain
a checksum-pinned installer from Qodo or their administrator (served from https://get.qodo.ai),
and never invent a digest or pipe an installer into a shell.

**Sandbox auth diagnostic.** In a sandboxed environment, if `qodo read whoami` fails for any
reason (including `Not logged in`), ask the user to approve one exact read-only retry of
`qodo read whoami` outside the sandbox before recommending login or refreshing tools: keychain
failures can be reported as generic auth failures, so the sandboxed result alone is not
diagnostic. That approval covers only this single retry — never reuse it, request persistent
approval, or move later Qodo commands outside the sandbox. If the retry succeeds, continue with
normal per-command permission checks; if it still fails, follow the auth troubleshooting below.

Add `--json` to everything you parse, and **confirm the exact tool names and flags with
`qodo read tools rules [<tool>] --json`** (renders offline from the cached catalog; inspect write
commands with `qodo tools help rules [<tool>] --json`). The commands above are illustrative — a
stale catalog shows as `unknown command`/`unknown option` on `rules` while `whoami` succeeds, so
run `qodo tools --refresh` and retry before assuming a tool is gone.

## Preflight

1. **Auth first.** Run `qodo read whoami`. After the sandbox retry above when applicable, tell the
   user to run `qodo login` only when the result explicitly says `Not logged in`, then stop. `No
   tool catalog cached` is a catalog failure, not proof of missing credentials: run
   `qodo tools --refresh` once, then retry `whoami`. If either still fails, report that exact
   failure and stop instead of sending the user through login. An `unknown command`/`unknown
   option` on `rules` while `whoami` succeeds is also a stale catalog — refresh once and retry.
2. **Admin gate.** Read `organization_permission` from the `whoami` JSON and compare it
   case-insensitively. Continue only when it is `owner` or `admin`. For any other value (for
   example `member`), stop before any further Qodo command and tell the user plainly: *"This
   requires admin permission in your workspace — ask an admin to make the change or grant you
   access."* Severity changes are admin-gated on the platform, so a non-admin has nothing useful
   to do here: do not continue to the catalog check, do not retry, and do not treat installation
   as evidence of authority. If the output is not parseable JSON, or `organization_permission` is
   absent or unrecognized, report the exact output and stop — never infer permission. Keep
   `workspace_id` and `organization_permission` for the outcome block; never invent a
   `workspace_id` — if it is absent, the block says "workspace id not reported by whoami".
3. **Catalog check.** Run `qodo tools --json` and confirm `rules-update`, `rules-list`,
   `rules-get`, and `rules-metadata` are listed; this version calls `rules-list` (export) and
   `rules-update` (apply). Take each tool's command path from the catalog's `command` field (and
   `readCommand` for the read tools), not from any command written in this file: export runs
   `<launcher> read rules list …` and apply runs `<launcher> rules update …`, so confirm both and
   pass the tails as `--read-args` / `--update-args` if they differ. If a tool is missing, or the
   `rules` commands answer `unknown command`/`unknown option` while `whoami` succeeded, run
   `qodo read tools rules --json` as the diagnostic (offline, from the cached catalog), then
   `qodo tools --refresh` once and retry. If it still fails, report the exact failure and the
   diagnostic output and stop.

## Rubric

The rubric — the fixed tag taxonomy, each tag's default severity, the platform-category prior, and
the keyword guard — is documented in `<skill-dir>/references/rubric.md`. Read it before
classifying. The admin's editable copy lives at `${QODO_HOME:-$HOME/.qodo}/calibrate/rubric.yaml`
(schema: `version: 1`, `severity_overrides` tag → severity, `guard_terms_extra` list; nothing else).

1. **Interrupted run?** List `${QODO_HOME:-$HOME/.qodo}/calibrate/runs/`. If it has folders, run
   `node <skill-dir>/scripts/record-batch.mjs --run <newest> --status`: when `batches_remaining`
   is non-empty (or `export.json` is missing), that run is unfinished — tell the user and resume
   it: reuse its folder, **skip step 2** (its `rubric-snapshot.yaml` already pins the rubric the
   recorded batches were classified under), and continue with Export and Classify. A run whose
   `receipt.md` frontmatter has no `apply_exit_code`, or has `apply_exit_code: 3`, resumes at
   Apply instead — read the frontmatter, never count status tokens, since an invalid row never
   gets one. Otherwise mint a new run id `$(date -u +%Y%m%d-%H%M%S)` (PowerShell: see Quick start)
   and the folder `${QODO_HOME:-$HOME/.qodo}/calibrate/runs/<run-id>/`.
2. **New run only.** Run `node <skill-dir>/scripts/rubric.mjs --snapshot <run-dir>/rubric-snapshot.yaml`
   (it honors `QODO_HOME`). On a first run it copies
   `<skill-dir>/references/rubric-defaults.yaml` to `rubric.yaml` and reports `"created": true` —
   tell the user the path, that the file is theirs to edit (a tag's severity under
   `severity_overrides`, guard words under `guard_terms_extra`), and that the next run picks up
   edits. If the snapshot already exists the script refuses (exit 2): that is a resumed run, skip
   this step. Never pass `--replace-snapshot` yourself — it re-pins a run whose recorded batches
   were classified under the old rubric.
3. On every new run the script validates the file and merges it with the defaults. Exit code 2
   with a quoted line means the rubric is invalid: the message names the file, line, and the valid
   tags or severities. Show it verbatim and stop until the admin fixes the file.
4. On success it prints `severities` (the effective tag → severity map), `guard_terms` (defaults
   plus `guard_terms_extra`), and `snapshot`, having written the merged rubric verbatim to
   `<run-dir>/rubric-snapshot.yaml`. Export and classify both read that snapshot, so the run is
   pinned to the rubric as it was when the run started.

## Export

Run the bundled script — one Bash invocation, read-only against the workspace:

```
node <skill-dir>/scripts/export-rules.mjs --out <run-dir> --qodo <launcher>
```

The script requires `<run-dir>/rubric-snapshot.yaml` and takes the guard terms from it (there is no
other guard-term input). It runs `<launcher> read rules list --state active --page-size 100 --page
N --json`; if the catalog's `readCommand` for `rules-list` is anything other than
`qodo read rules list`, pass its tail as `--read-args "<words after qodo>"`. Paging stops when the
fetched count reaches `totalCount` or a page comes back empty, and must then equal `totalCount`.
Rules carry full examples, so a 100-rule page can exceed the runtime's per-result byte cap; on the
truncation marker the script halves the page size (50, 25, …, never below 10) and continues from
the rules already fetched. On `MT-RATE-LIMITED` (JSON or stderr) it waits 5 s and retries the page
once. Any other failure, a count mismatch, a duplicate id, a page over 120 s, or a `totalCount`
that changes mid-export exits 2 with the counts and the launcher's stderr tail in the message and
nothing written — report it and stop; do not classify.

On success (exit 0) it prints one JSON line (`totalCount`, `exported`, `pages`, `page_size`,
`batches`, `guard_hit_rules`) and has written `<run-dir>/export.json` (`run_id`, `exported_at`,
`totalCount`, and `rules` exactly as returned by the CLI — raw, never edit it; written last and
atomically, so a half-written export never exists) and `<run-dir>/batches/batch-NNN.json` (the
rules ordered by `ruleId` in batches of 40, each reduced to `ruleId`, `name`, `category`,
`severity`, `content`, and `guard_hits` — the guard terms whose case-insensitive stem matched the
name or content, precomputed).

A rule's portal URL is its `url` field when present, else `https://app.qodo.ai/rules/<ruleId>`. If
`totalCount` is 0, the script writes an `export.json` with zero rules and no batch files: render
the outcome block saying there is nothing to calibrate and stop. If `export.json` already exists (a
resumed run) the script leaves everything in place and reports `already_exported`; if it exists but
`batches/` is missing or empty it stops and tells you to remove `export.json` to re-export — ask
the user before deleting anything.

## Classify

Classification is your judgment, batch by batch; the arithmetic is the script's. Work only from
the batch files — never from `export.json` summaries and never from a rule's name alone.

1. Run `node <skill-dir>/scripts/record-batch.mjs --run <run-dir> --status`. It lists
   `batches_done` and `batches_remaining` from `<run-dir>/classification.json`. A re-run in the
   same run folder resumes at the first remaining batch; batches already present are skipped.
2. For each remaining batch, in order: read `batches/batch-NNN.json` **in full**. For every rule,
   read the whole `content` with `name` and `category`, and assign exactly one tag from the
   taxonomy in `references/rubric.md`. When two tags fit, choose the higher default severity
   ("never log tokens" is `secrets-handling`, not `logging`). Its "Tagging: common calls" table
   names the tag for each common kind of rule — read it. Long batch? Read it in parts; never skip
   one or tag from a skim.
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
   `needs_decision`, `batch`. `proposed` is the effective rubric's severity for the tag; a guard
   hit or a `Security`/`Compliance` category vetoes a **decrease** into a `needs_decision` row
   whose `proposed` equals `current` (layers 2 and 3 in `references/rubric.md` — increases are
   never vetoed). It rewrites the file atomically after each batch, so an interruption loses at
   most the batch in progress, and reports the batch's counts and the running totals.
5. After the last batch, run `--status` once more: `decrease`, `increase`, `unchanged`, and
   `needs_decision` are disjoint and sum to `rows`, and `batches_remaining` must be empty before
   the proposal will render. Then continue with Summarize.

## Summarize

Every row that will appear in the proposal needs a one-line summary, written by you from the
rule's full `content`. The proposal refuses to render while one is missing.

1. `node <skill-dir>/scripts/proposal.mjs --run <run-dir> --summaries-needed --limit 20` lists the
   rules that still need one, each with `rule_id`, `name`, `tag`, and the full `content`. Only
   rows that will be rendered are listed: never an unchanged rule or one held by a prior decision.
2. Write one sentence per rule from that content — what the rule requires — at most 160
   characters, on one line, with no ` · `, no `→`, and no `…`. It is display-only: never classify
   from a summary, and never paste a truncated slice of the content as one.
3. Record the chunk in one call, as a JSON object of rule id to summary:
   `node <skill-dir>/scripts/proposal.mjs --run <run-dir> --record-summaries '{"815399":"Every public function carries a docstring"}'`
   — or the same JSON in a file with `--summaries-file <path>` (the Windows form). An invalid
   summary refuses the whole chunk, names the offending ids, and records nothing; a blank summary
   counts as missing. Chunks merge into `<run-dir>/summaries.json`; repeat until `needed_total` is
   0. A row under `missing_content` has no rule text in `export.json` — say so rather than
   inventing a summary.

## Propose

```
node <skill-dir>/scripts/proposal.mjs --run <run-dir> --render --workspace-id <workspace_id>
```

This writes `<run-dir>/proposal.md`: the diff-only checklist grouped by direction × tag, every
rubric-proposed row pre-checked, every needs-a-decision row unchecked, the run's rubric snapshot in
the frontmatter, and a footer counting the rules held by a prior decision. The grammar, section
wording, and frontmatter are in `<skill-dir>/references/proposal-format.md` — read it before you
explain the file, and never hand-write or hand-edit a row. Take `<workspace_id>` from `whoami`.

It refuses with exit 2 and writes nothing when the classification is incomplete (it names the
remaining batches), a rendered row has no summary (it lists the ids), or `proposal.md` already
exists. `--replace` overwrites it — ask the admin first, because their edits are discarded.

Then hand the file to the admin: the path, and that a checked row is approved, unchecking skips it,
editing the value after `→` is an override, and needs-a-decision rows start unchecked because a
guard term or the platform category contradicts the decrease. Ask them to say when they are done,
and do not edit the file for them.

## Approve

```
node <skill-dir>/scripts/approve.mjs --run <run-dir> --readback
```

The readback prints each row's decision plus `counts`, `invalid`, `removed`, and `readback_text`.
Show `readback_text` verbatim, name every invalid row by line number and reason and say it is
excluded, mention `removed` rows if any, then ask for explicit confirmation. Nothing is written
at this point.

Only after the admin says yes: `node <skill-dir>/scripts/approve.mjs --run <run-dir> --record-skips`
appends their skipped rows to the decisions ledger, once per run (a second call reports
`already_recorded`). That confirmation, together with the edited file, authorizes the whole apply
loop — continue to Apply. Approvals and overrides go into the ledger after they are applied, not
here.

## Apply

Generate the loop only after the admin's explicit yes, then run it as **one** Bash invocation:

```
node <skill-dir>/scripts/apply.mjs --run <run-dir> --generate --qodo <launcher>
sh "<run-dir>/apply.sh"
```

`--generate` reads the decisions back (from `receipt.md` when it exists, otherwise `proposal.md`),
writes `<run-dir>/receipt.md` — the admin's file plus a status token per row — and writes
`<run-dir>/apply.sh`, one row per approve/override decision in file order. It prints
`rows_to_apply`, the rule ids, `skipped`, and `skips_recorded`: it appends those skips to the
ledger itself, with the same per-(run, rule) dedupe as `approve.mjs --record-skips`, so they are
on record either way. `rows_to_apply: 0` reports `nothing_to_apply` and writes no script — say
nothing was applied. If the catalog's `command` for `rules-update` is anything other than
`qodo rules update`, pass its tail as `--update-args "<words after qodo>"`.

`invalid` lists every row the readback excluded, by line and reason. Those rows stay excluded for
the **rest of this run** and are re-proposed on the next one, so name them to the admin *before*
they say yes and offer to let them fix the file and read it back — an invalid override is a
severity they asked for and will not get.

Then run `sh "<run-dir>/apply.sh"` — **once, as a single Bash invocation**, path quoted. Never
call `apply.mjs --row` yourself, never loop over the rows as separate tool calls, and never call
`qodo rules update` directly: the one invocation is what makes the admin's single confirmation
cover the batch. Each row runs `qodo rules update --rule-id <id> --severity <target> --json
--idempotency-key calibrate-<run-id>-<rule-id>` and writes nothing else.

The script ends by printing one JSON report: `counts` (applied, failed, deferred, pending,
skipped, invalid), `non_applied` with each row's id, status, and code, `invalid`, `aborted`, and
the receipt path. Exit 0 means every approved row applied; 3 means at least one did not (name each
`non_applied` row by id and code; `aborted: true` means the loop stopped early — see Error
Handling). Report from the JSON, not from the receipt text.

**Resume** by regenerating and re-running the same two commands: rows already `applied` or
`· skipped` are never re-sent, `failed` and `deferred` rows are. The grammar, failure policy, exit
codes, and resume rules are in `<skill-dir>/references/receipt-format.md` — read it before you
explain the receipt. Never edit `receipt.md`, `proposal.md`, or `apply.sh` by hand.

## Decisions ledger

`${QODO_HOME:-$HOME/.qodo}/calibrate/decisions.jsonl` remembers what the admin already decided, so
a second run does not ask twice: `skip` entries after the confirmation, `approve`/`override` for
the rows that actually applied. A rule is held out of the proposal while a skip or override still
matches its content hash, or an approve still matches its current severity; the footer counts
them. `ledger.mjs --show` prints the effective entry per rule; on "reconsider rule 815412" run
`ledger.mjs --reconsider 815412` and re-render with `--replace` (an id with no entry is reported
as nothing to release). Semantics: `references/proposal-format.md`.

Release a rule **before** the admin starts editing, or on the next run: re-rendering mid-edit with
`--replace` discards everything they have changed, so ask first and say that is the cost —
otherwise note the request and run it at the start of the next run.

## Report the verified outcome

After a read or mutation returns structured results, lead with one compact summary — `Outcome`
(what was found or changed), `Scope` (the workspace and paths involved), `State` (the actual
counts). Use the response's real state and succeeded/matched counts; never turn a successful HTTP
response into a stronger claim. Render it once per user-requested operation, not before the
confirmation gate and not for auth, permission, validation, or transport failures; put rule names,
ids, before/after fields, and skipped items below it. For this version the operation ends at the
applied receipt, so fill the block from the render output, the readback, and the apply report:

```
# 🛡️ Qodo Review Standards

**Outcome:** Exported <total_rules> active rules and classified all <rows> against the rubric, then proposed <rows-in-proposal> severity changes (<proposed> pre-checked · <needs_decision> needing a decision · <held_by_prior_decision> held by earlier decisions). Readback: <readback_text>. Applied <counts.applied> of <rows_to_apply> approved rows — <counts.failed> failed · <counts.deferred> deferred · <counts.pending> pending · <counts.skipped> skipped · <counts.invalid> invalid. Recorded <recorded> skips and the applied decisions in the ledger. Verification and revert arrive in a later version of this skill.
**Scope:** workspace <workspace_id>; run folder ~/.qodo/calibrate/runs/<run-id>/ (export.json, batches/, rubric-snapshot.yaml, classification.json, summaries.json, proposal.md, receipt.md, apply.sh, apply-results.jsonl); rubric ~/.qodo/calibrate/rubric.yaml (created this run | <n> overrides applied); ledger ~/.qodo/calibrate/decisions.jsonl
**State:** permission <organization_permission>; apply exit code <apply_exit_code>; current severities before this run: <current_counts.error> error · <current_counts.warning> warning · <current_counts.recommendation> recommendation
---
```

List every non-applied and invalid row by id and code below the block. If the run stops at
classification or at the open checklist, report the counts and the proposal path and say the
decision is still open. For an empty workspace the Outcome line says the export found 0 active
rules and there is nothing to calibrate. Do not render the block when the CLI is missing or too
old, when the user is not logged in, when the admin gate fails, when the catalog check fails after
one refresh, when the rubric is invalid, or when a script exits non-zero for a reason other than a
non-applied row — those stops get the plain message for that step instead.

## Error Handling

- **Permission denied (admin required)** — severity changes are admin-gated. Say plainly: *"This
  requires admin permission in your workspace — ask an admin to make the change or grant you
  access."* Don't retry; it cannot succeed without a permission change.
- **Not installed** — both `qodo` and `${QODO_HOME:-$HOME/.qodo}/bin/qodo` are missing. Point the
  user to a checksum-pinned installer from Qodo or their administrator and stop.
- **Runtime too old or unparseable version** — the compatibility gate above owns this: explain,
  offer `qodo update` once, re-probe on accept, stop otherwise. Never run `whoami` on an old one.
- **Not logged in** — after the single sandbox diagnostic retry when applicable, tell the user to
  run `qodo login` and stop.
- **Stale catalog** — `unknown command`/`unknown option` on `rules`, or a required tool missing
  from `qodo tools --json`, while `whoami` works: `qodo tools --refresh` once and retry; if it
  still fails, report the exact failure and stop.
- **Invalid rubric** (`rubric.mjs` exit 2 with a quoted line) — quote the message (it names the
  file, line, and valid values) and stop before export; never "fix" the admin's rubric yourself.
  Exit 2 saying the snapshot exists means a resumed run: skip the rubric step.
- **Node.js too old** — every script checks for Node 20+ and prints one line; ask the user to
  install a current Node.js (the Qodo CLI needs it too).
- **Short or failed export** (`export-rules.mjs` exit 2) — report the counts from stderr and stop;
  no classification. A `totalCount` that changed mid-run means rules were edited during export —
  re-run the script in the same run folder.
- **Rate limited (`MT-RATE-LIMITED`) or upstream down (`MT-UPSTREAM-DOWN`)** — export waits 5 s
  and retries the page once; apply retries the row with exponential backoff up to five times, then
  marks it `deferred`. For any other command, wait and retry by hand once; if still failing, report
  it and stop. A `deferred` row is resumed later, when the limit or the outage clears.
- **Batch refused** (`record-batch.mjs` exit 2) — the message lists every missing rule or invalid
  tag; complete the mapping and record the batch again.
- **Summary chunk refused** (`proposal.mjs` exit 2) — the message names each id and what is wrong
  (separator, arrow, truncation mark, length); nothing was recorded. Rewrite those summaries and
  record the chunk again.
- **Render refused** (`proposal.mjs --render` exit 2) — an incomplete classification (finish the
  named batches), a missing summary (record the listed ids), or an existing `proposal.md` (ask the
  admin before `--replace`). Nothing was written; never work around it by writing the file yourself.
- **Readback refused** (`approve.mjs` exit 2) — no `proposal.md` yet, or its frontmatter `run_id`
  belongs to another run. Point at the right run folder; never edit the frontmatter to match.
- **Invalid or removed rows in the readback** (exit 0) — not a failure: report them by line number
  with the reason, say they are excluded, and let the admin fix the file and read it back again.
- **Apply refused** (`apply.mjs` exit 2) — no `proposal.md` or `receipt.md`; a frontmatter
  `run_id` that names another run; a `--target` that is not a severity; a rule with no row in this
  receipt; or a receipt row that disagrees with `apply.sh` (unchecked, already `· skipped`, or a
  different target) — that last one means the script is **stale**: regenerate it and run the new
  one. Point at the right run folder; never edit the frontmatter or the script to match.
- **Apply ended in 1 or 2** (`sh apply.sh`) — the failure came from the final `--write-receipt`,
  so **no report was printed**: `1` is Node older than 20, `2` is a missing receipt or one from
  another run. Fix the cause, then run `apply.mjs --run <run-dir> --write-receipt` for the report.
- **Apply aborted** (`sh apply.sh` exit 3 with `aborted: true`) — an auth, permission,
  missing-tool, or bad-argument error. Rows before it are applied, that row and every later one
  are still pending, and no further call was made. Fix the cause (`qodo login`, admin permission,
  `qodo tools --refresh`), then resume by regenerating. Do not retry the row by hand.
- **Rows not applied** (`sh apply.sh` exit 3) — read `non_applied` from the JSON and name every
  row by id and code. Regenerating re-sends `failed` and `deferred` rows along with the pending
  ones, so one resume is the right response; a row that fails a **second** time with the same code
  is a real rejection — report it and let the admin decide. Never run its `--row` by hand.
- **`applied` without confirmation** — `--row` warns `response carried no severity` and the result
  line reads `severity_verified: false`. The write is recorded as applied (exit 0 and a JSON object
  with no error is success) but unconfirmed; say so, and note that verify will settle it.
- **`response_mismatch`** — the update returned a different severity: the row is not applied, the
  workspace may have been edited concurrently, and retrying is not the answer.

## Guardrails

- **`severity` is the only field written.** Never state, scope, content, examples, name, or
  category; never `rules-bulk`, `rules-set-state`, `rules-set-scope`, or `rules-create`. Every
  phase before Apply is read-only (`--version`, `read whoami`, `tools --json`, `tools --refresh`,
  `read tools rules`, `read rules list`). Under `${QODO_HOME:-$HOME/.qodo}/calibrate/` it writes
  `rubric.yaml` (first run only), `decisions.jsonl` (the ledger — `skip` entries once the admin
  confirms or `--generate` runs, `approve`/`override` after apply, `released` on a reconsider), and
  `runs/<run-id>/` (`export.json`, `batches/`, `rubric-snapshot.yaml`, `classification.json`,
  `summaries.json`, `proposal.md`, `receipt.md`, `apply.sh`, `apply-results.jsonl`) — plus the
  CLI's own catalog cache. Write nothing into the skill install directory or a repository.
- **Nothing is written before the admin's explicit yes.** The readback writes nothing, and no
  `apply.sh` is generated or run before the confirmation. Never edit their `proposal.md`,
  `receipt.md`, or `apply.sh`, and never `--replace` a proposal without asking.
- **The apply loop is one Bash invocation.** `sh "<run-dir>/apply.sh"` and nothing else — never
  `apply.mjs --row` by hand, never a per-row tool call, never `qodo rules update` directly.
- **Never fabricate a rule id, scope, or example.** Resolve or ask; an empty result from `list`
  is a valid outcome, not an error.
- **Classify from the full content.** Never tag a rule from its name or a summary, never skip a
  batch because it is long, and never edit `export.json` or a batch file.
- **Tell the user which outcome actually happened** — active rule vs. pending suggestion,
  matched vs. succeeded count from a bulk call — don't assume success from a 200 response alone.
- **Documented departure.** The admin's edited checklist plus a confirmed readback of its counts
  authorize the whole apply loop, instead of a confirmation before every write. This is a
  deliberate, documented departure from `qodo-manage-standards`'s confirm-before-every-write
  guardrail. It is limited to this apply step, writes exactly one field, and records a per-row
  receipt that supports revert.

Lead with the bottom line — what was applied, what the admin decided, or what stopped the run and
why — then the specifics. A short, accurate status beats a wall of JSON. Verification and revert
follow in a later version of this skill.
