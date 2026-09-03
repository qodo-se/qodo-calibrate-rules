# Receipt and apply format

The receipt is the run's record of what happened to each approved row, and `apply.sh` is the
loop that produced it. The grammar below is encoded in `scripts/lib/receipt-lib.mjs`; that file
is the source of truth and this page is the human-readable copy. The test suite pins the two
together where drift would be silent: the version stamped into the script header and the
status-token vocabulary.

## receipt.md

`<run-dir>/receipt.md` starts as a byte-for-byte copy of `proposal.md` **as the admin edited it**
and then gains a status token after each row's url. **`proposal.md` is never modified** — it stays
the record of what the admin was asked and what they answered.

```
- [x] 815399 · Public functions must have docstrings · Every public function carries a docstring · error → recommendation · https://app.qodo.ai/rules/815399 · applied
- [x] 815401 · Keep lines under 120 columns · Lines wrap at 120 columns · warning → recommendation · https://app.qodo.ai/rules/815401 · failed(MT-VALIDATION) · applied
- [ ] 815412 · Document sanctions-screening functions · Sanctions screening helpers name their list source · warning → recommendation · guard: sanctions · https://app.qodo.ai/rules/815412 · skipped
```

Token vocabulary, in the order the workflow can add them:

| Token | Meaning |
|---|---|
| *(none)* | **pending** — the row is approved and has not been attempted, or the loop aborted before reaching it |
| `· applied` | the update succeeded |
| `· failed(<code>)` | the update did not succeed. For a code the server returned — `MT-VALIDATION`, `MT-NOT-FOUND`, `response_mismatch` — the rule was not changed. For `timeout`, `invalid_json`, `empty_output`, `non_zero_exit`, or `result_too_large` the request may have reached the platform and the **outcome is unknown** until verify re-reads the rule |
| `· deferred` | rate limited (`MT-RATE-LIMITED`) or the upstream was down (`MT-UPSTREAM-DOWN`) past the retry ceiling; nothing was changed, retry later |
| `· skipped` | the admin left the row unchecked |
| `· verified` / `· mismatch(<actual>)` / `· reverted` | written by verify and revert (a later version) |

Tokens **accumulate left to right** and the **last one is the effective status**: a row that
failed and then applied on a resume reads `· failed(MT-VALIDATION) · applied` and counts as
applied. An invalid override carries no token at all — it is excluded from apply and listed in
the report instead. The row grammar in `references/proposal-format.md` is right-anchored on the
url, so every token must be stripped before a row parses; `receipt-lib` does that for the
readback, which is why the receipt and the proposal can never disagree about a decision.

Frontmatter is the proposal's, plus these keys as `--write-receipt` stamps them:

| Key | Value |
|---|---|
| `applied_at` | ISO time the last apply attempt finished |
| `apply_exit_code` | `0` when every approved row applied, `3` otherwise |

## apply-results.jsonl

`<run-dir>/apply-results.jsonl` is the append-only record of **every attempt**, written *before*
`receipt.md` is rewritten, so a crash between the two loses nothing:

```json
{"rule_id":815399,"target":"recommendation","current":"error","status":"applied","code":null,"message":null,"attempt":1,"idempotency_key":"calibrate-20260902-190914-815399","at":"2026-09-02T19:11:04.201Z"}
```

`status` ∈ `applied | failed | deferred | aborted | retrying`. Only the first three become a
token: an `aborted` row stays pending (the workspace was not touched), and `retrying` is one
rate-limited attempt inside a row that has not finished yet. Folding takes the **last** result
per rule, which is what makes a re-fold idempotent.

## apply.sh

`--generate` writes POSIX `sh` with absolute paths — one `row` line per approve/override
decision, in file order:

```sh
#!/bin/sh
# qodo-standards-calibrate 0.5.0 · run 20260902-190914 · 5 rows · generated 2026-09-02T20:10:00Z · do not edit
# One Bash invocation applies the whole batch: sh apply.sh. Never run the rows by hand.
set -u
ABORTED=0
row() { [ "$ABORTED" -eq 1 ] && return 0; "/path/to/node" "/…/scripts/apply.mjs" --run "/…/runs/20260902-190914" --qodo "/…/bin/qodo" --row "$1" --target "$2"; rc=$?; case "$rc" in 30|1|2|126|127) ABORTED=1 ;; *) if [ "$rc" -gt 128 ]; then ABORTED=1; fi ;; esac; return 0; }
row 815399 recommendation    # qodo rules update --rule-id 815399 --severity recommendation --json --idempotency-key calibrate-20260902-190914-815399
…
exec node "/…/scripts/apply.mjs" --run "/…/runs/20260902-190914" --write-receipt
```

- **One invocation.** Run it as `sh "$RUN/apply.sh"` and nothing else. The whole point of the
  generated script is that the admin's edited checklist plus the confirmed readback authorize one
  host permission prompt for the batch; issuing the rows as separate tool calls defeats that and
  is explicitly forbidden.
- **The interpreter is an absolute path**, not the bare word `node`: a non-interactive `sh` can
  have a minimal PATH — exactly what a GUI-launched agent gets — and `node: not found` on every
  row would look like a workspace failure instead of a PATH one.
- **`set -e` is deliberately absent.** A failed or deferred row must not stop the loop. Only a
  row that cannot make progress sets `ABORTED`: exit `30` (abort class), `1` (usage / Node too
  old), `2` (refused — no receipt, another run's `run_id`, a stale script), `126`/`127` (the
  interpreter cannot be run) or death by a signal. After that every later `row` returns without
  calling anything; the
  script still ends in `--write-receipt`, so the agent always gets the report.
- Each comment records the exact command that row runs, for audit. The script is regenerated (and
  overwritten) on every `--generate`; `apply-results.jsonl` is never rewritten.
- On Windows, run it under **Git Bash** or **WSL**. There is no PowerShell apply script.

Installation docs may suggest a host allow-rule for the one command the loop needs, e.g.
`Bash(sh ${QODO_HOME:-$HOME/.qodo}/calibrate/runs/*/apply.sh)` — expanded to the real absolute
path, since a host matches allow-rules literally — or for the resolved `qodo rules update` command
path. The skill never adds an allow-rule itself.

## Failure policy

One update per row: `qodo rules update --rule-id <id> --severity <target> --json
--idempotency-key calibrate-<run-id>-<rule-id>`. Nothing else is sent, and `severity` is the only
field ever written. Success means exit 0 **and** a JSON object with no error; if the response
carries a `severity` it must equal the target.

| Class | Trigger | Action | Row | Row exit |
|---|---|---|---|---|
| **abort** | `not_logged_in`, `tool_unavailable`, `unknown_tool`, `invalid_arguments`, `no_catalog`, any `catalog_*`, a code or message matching auth / permission / forbidden / unauthorized / admin, or a launcher that cannot be spawned | stop the loop; later rows are never called | stays **pending** | `30` |
| **retry** | `MT-RATE-LIMITED` (in the JSON or on stderr), `MT-UPSTREAM-DOWN` | same row again, backoff `2s · 2^n`, max 5 retries | `applied`, else `deferred` | `0` / `20` |
| **fail** | anything else — 120 s timeout, the runtime's truncation marker, non-JSON output, `MT-VALIDATION`, `MT-NOT-FOUND`, a severity that came back wrong (`response_mismatch`), … | record and continue | `failed(<code>)` | `10` |
| success | — | continue | `applied` | `0` |

`CALIBRATE_BACKOFF_MS` overrides the 2000 ms backoff base, but **only when
`CALIBRATE_TEST_MODE=1` is set as well** — both exist for the test suite, and the second one is
what stops a variable left in a shell profile from turning a rate-limited run into five instant
retries. `CALIBRATE_TIMEOUT_MS` overrides the 120 000 ms per-row timeout. Never set any of them on
a real run.

Each result line carries `severity_verified`: `true` when the response named the severity we asked
for (at the top level or under `rule`, `result`, or `data`, compared case-insensitively), `false`
when the response carried no severity at all. A row still counts as `applied` in the second case —
exit 0 with a JSON object and no error is the success rule — but `--row` says so on stderr and
verify (story 5) is what settles it. A response naming a *different* severity is never applied: it
is `failed(response_mismatch)`.

## Exit codes

| Mode | Code | Meaning |
|---|---|---|
| `--row` | `0` | applied |
| `--row` | `10` | failed — the loop continues |
| `--row` | `20` | deferred — the loop continues |
| `--row` | `30` | abort class — the loop stops here |
| `--write-receipt` | `0` | every approved row is `applied` |
| `--write-receipt` | `3` | at least one row is failed, deferred, or pending |
| any | `1` | usage, or Node older than 20 |
| any | `2` | refused: no proposal, no receipt, a `run_id` that names another run, a target that is not a severity, a rule with no row in this receipt, or a row whose receipt entry disagrees with the script — unchecked, already `· skipped`, or a different target (a stale `apply.sh`) |

`sh apply.sh` ends in `--write-receipt`, so it normally exits `0` when everything applied and `3`
otherwise — including an abort, which the report marks with `aborted: true` and the aborted row's
code in `non_applied`. The per-row `30` is the loop's internal signal only.

It can also end in `1` or `2`, which come from that final `--write-receipt` rather than from a
row: `1` means Node is older than 20, `2` means the receipt is gone or belongs to another run. In
both cases **no report was printed** — fix the cause, then run
`node apply.mjs --run "$RUN" --write-receipt` by hand. That command also produces the report if
the script is killed before its last line; it folds the pending results first, so nothing is lost.

## Resume

An interrupted apply resumes by regenerating and re-running:

```
node <skill-dir>/scripts/apply.mjs --run "$RUN" --generate --qodo <launcher>
sh "$RUN/apply.sh"
```

- Decisions come from `receipt.md` when it exists, otherwise `proposal.md`. When both exist and
  their rows differ, the receipt wins and the run warns that `proposal.md` is ignored — the admin
  edited the proposal after the apply started.
- Rows already `applied` are **never** regenerated, so no rule is written twice. Neither is a row
  the receipt marks `· skipped`. Everything else is re-sent: **regenerating re-attempts the
  `failed` and `deferred` rows as well as the pending ones.** That is deliberate — a rate limit or
  a transport failure usually clears — but a row that fails a *second* time with the same code is
  a real rejection: report it by id and code and let the admin decide. Do not run its `--row` by
  hand, and do not loop on it.
- Pending results are folded into the receipt before the readback, so a crash between the results
  append and the receipt rewrite closes itself on the next `--generate` or `--write-receipt`.
- A `run_id` in the **receipt** that does not name the run folder refuses the whole operation
  (exit 2) and writes nothing. Never edit the frontmatter to make it match. A `proposal.md` that
  is unreadable or belongs to another run only warns: on a resume the receipt is the source of
  truth.
- A receipt that was deleted while `apply-results.jsonl` survived is rebuilt from `proposal.md`
  with those results folded back in, and the run warns — so a deleted receipt does not re-send
  rows that already applied.
- Zero rows to apply reports `nothing_to_apply`, writes the receipt with its `· skipped` rows, and
  writes no script.

## Ledger entries after apply

`--write-receipt` appends one `approve` or `override` entry per **applied** row to
`${QODO_HOME:-$HOME/.qodo}/calibrate/decisions.jsonl`, with `severity_at_decision` set to the
target that was written and a `sha256:` hash of the rule's exported content. Dedupe is per
(run, rule), so a second `--write-receipt` adds nothing. Failed, deferred, and pending rows are
**never** recorded: nothing was decided into the workspace, so they must be proposed again.
Because an `approve` is held only while the rule still sits at the approved severity, recording
the target (not the old value) is what makes the next run hold the row.

## Error handling — apply

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
