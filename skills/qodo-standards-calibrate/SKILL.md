---
name: qodo-standards-calibrate
description: Calibrate the severity of every active Qodo Review Standards rule across the workspace as one reviewable, reversible batch — export the active rules, propose a severity per rule from a fixed rubric, let the workspace admin approve or override each row, then apply only what was approved — using the qodo CLI's managed rules tools. Use on "calibrate our rule severities", "recalibrate review standards", "re-level the rules", "too many rules are errors", "bulk severity review", "which rules should be errors vs warnings"; skip changing one rule's severity or any single-rule edit (use qodo-manage-standards), reading or applying rules while coding (use qodo-get-rules), and anything that isn't workspace-wide severity calibration.
owner: Qodo
metadata:
  vendor: qodo
  version: "0.1.0"
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

**This version (0.1.0) implements the preflight only.** It confirms the runtime, authentication,
admin permission, and tool catalog, reports the outcome, and stops. It issues no write. Export,
classification, proposal, approval, apply, verify, and revert arrive in a later version.

## Prerequisites

- This skill is installed from its preview repository (skills.sh) and loaded explicitly.
- The Qodo CLI (0.1.0-next.37 or newer) is installed and authenticated.
- The user is an admin (`owner` or `admin`) of the workspace whose rules will be calibrated.

## Instructions

Follow the workflow below in order: preserve update notices, resolve the executable, pass the
compatibility gate, confirm authentication with provenance stamped on the first call, confirm admin
permission, confirm the tool catalog, then report the verified outcome. The provenance flags
(`--skill`, `--skill-version`, `--distribution`) go on the first authenticated call — `qodo read
whoami` — only; every other command runs without them. Every Qodo command in this version is
read-only. Stop at the first failed step with the plain message for that step.

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
qodo read whoami --json --skill qodo-standards-calibrate --skill-version 0.1.0 --distribution skills-sh
qodo tools --json                                                   # catalog must list rules-update, rules-list, rules-get, rules-metadata
qodo read tools rules --json                                        # exact safe flags (renders offline)
```

**`qodo: command not found`?** That's usually PATH, not a missing install: GUI-launched agents
run shells with a minimal PATH. On POSIX, retry `"${QODO_HOME:-$HOME/.qodo}/bin/qodo"`. In
Windows PowerShell, retry:

```powershell
$qodoHome = if ($env:QODO_HOME) { $env:QODO_HOME } else { Join-Path $HOME '.qodo' }
& (Join-Path $qodoHome 'bin/qodo.cmd')
```

Keep using the resolved launcher for every Qodo command here. Only if it is missing is Qodo
actually not installed; tell the user to obtain a checksum-pinned installer command from Qodo or
their organization's administrator. Installers are served from https://get.qodo.ai, but never
invent a digest or pipe an installer directly into a shell.

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
   `rules-get`, and `rules-metadata` are listed. This version calls none of them; they are the
   tools the later calibration steps use, and confirming them now surfaces a stale or incomplete
   catalog before any write exists. Take each tool's command path from the catalog's `command`
   field (and `readCommand` for the read tools) rather than trusting any command written in this
   file. If a tool is missing, or the `rules` commands answer `unknown command`/`unknown option`
   while `whoami` succeeded, run `qodo read tools rules --json` as the diagnostic (it renders
   offline from the cached catalog and shows exactly which `rules` tools the cache holds), then run
   `qodo tools --refresh` once and retry. If it still fails, report the exact failure and the
   diagnostic output, and stop.

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

For this version, a passing preflight is the one user-requested operation. Fill the block from
the actual probe results, for example:

```
# 🛡️ Qodo Review Standards

**Outcome:** Preflight passed — Qodo CLI <version>; catalog verified (rules-update, rules-list, rules-get, rules-metadata). Calibration steps (export, propose, apply, verify, revert) arrive in a later version of this skill.
**Scope:** workspace <workspace_id>
**State:** permission <organization_permission>; no rules read or changed
---
```

Do not render the block when the CLI is missing or too old, when the user is not logged in, when
the admin gate fails, or when the catalog check fails after one refresh — those stops get the plain
message for that step instead.

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
- **Rate limited (`MT-RATE-LIMITED`)** — wait about 5 seconds and retry the same command once; if
  still rate limited, report it and stop.

## Guardrails

- **No Review Standards writes in this version.** Every Qodo command here (`--version`,
  `read whoami`, `tools --json`, `tools --refresh`, `read tools rules`) leaves the workspace's
  rules untouched. Do not call `qodo rules update` or any other mutating tool, and write nothing
  into the skill install directory or `~/.qodo/` — except the CLI's own catalog cache, which
  `qodo tools --refresh` refreshes as part of the mandated stale-catalog recovery.
- **Never fabricate a rule id, scope, or example.** Resolve or ask; an empty result from `list`
  is a valid outcome, not an error.
- **Tell the user which outcome actually happened** — active rule vs. pending suggestion,
  matched vs. succeeded count from a bulk call — don't assume success from a 200 response alone.
- **Documented departure (forward reference).** Later versions apply approved severity changes as
  one batch: the admin's edited checklist plus a confirmed readback of its counts authorize the
  whole apply loop, instead of a confirmation before every write. This is a deliberate, documented
  departure from `qodo-manage-standards`'s confirm-before-every-write guardrail. It is limited to
  the calibration apply step, writes exactly one field (`severity`), records a per-row receipt that
  supports revert, and does not exist in this version.

Lead with the bottom line — what passed, what stopped the preflight and why — then the specifics.
A short, accurate status beats a wall of JSON.

Calibration steps — export, classify, propose, approve, apply, verify, revert — follow in a later
version of this skill.
