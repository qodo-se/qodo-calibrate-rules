# qodo-calibrate-rules

A skill that proposes and aids in automating adjustments to Qodo rule severities, based on an
editable rubric.

## Prerequisites

**Qodo CLI**, installed and logged in:

```sh
qodo --version
qodo login
```

If the CLI isn't installed, ask Qodo or your organization's administrator for the current
checksum-pinned installer — they're served from https://get.qodo.ai. Don't pipe an installer
straight into a shell.

The skill probes the CLI version before it does anything and offers `qodo update` once if the
runtime is too old.

**Admin permission in the Qodo portal.** Severity changes are admin-gated on the platform, so your
workspace permission must be `owner` or `admin`. The skill checks this up front and stops with a
plain message for anyone else — it stops before generating a proposal, so a member can review a
proposal an admin shares with them, but cannot produce or apply one.

**Node.js 20 or newer.** The bundled scripts use Node built-ins only; there is nothing to
`npm install`.

**Windows: Git Bash or WSL.** The skill both applies and undoes its changes by running generated
POSIX `sh` scripts, which PowerShell can't execute. Everything else works in PowerShell.

## Install

```sh
npx skills add qodo-se/qodo-calibrate-rules
```

## Use it

Ask your agent to calibrate the workspace — *"recalibrate our review standards"*, *"too many rules
are errors"*, *"which rules should be errors vs warnings"*. It hands you a checklist of only the
rules whose severity would change, each with its current and proposed value and a link to the rule
in the portal. Edit that file in your editor or in the bundled browser page, say you're done, and
confirm; the skill applies the approved rows, re-reads the workspace to confirm each one landed,
and reports anything that didn't.

Runs, the receipt, and your rubric live under `${QODO_HOME:-$HOME/.qodo}/calibrate/` — nothing is
written into a repository or the skill's install directory. The receipt grammar, exit codes, and
resume rules are documented in
[references/receipt-format.md](skills/qodo-calibrate-rules/references/receipt-format.md).

## Customize the rubric

The skill proposes a severity for each rule by tagging it with one of 13 taxonomy tags
(`documentation`, `security-control`, `data-integrity`, …) and applying that tag's default
severity. A keyword guard then flags rules that mention sensitive terms such as `auth`,
`secret`, or `migration`. Both are adjustable in the rubric shared by all workspaces using the same
`QODO_HOME`; use separate `QODO_HOME` directories if you need independent settings.

Your copy of the rubric is `${QODO_HOME:-$HOME/.qodo}/calibrate/rubric.yaml`. It is created on the
first run and never overwritten, so your edits persist across skill updates. Only three top-level keys
are permitted — `version: 1` is required, while the two customization keys are optional and behave as
empty values when omitted. Adding any other key stops the run:

```yaml
version: 1
severity_overrides:      # tag -> error | warning | recommendation
  documentation: warning
  logging: error
guard_terms_extra:       # appended to the default keyword guard
  - billing
  - invoice
```

- **`severity_overrides`** changes the default severity for a tag. Tags you leave out keep their
  defaults. Replace the empty `{}` with a mapping rather than adding a second
  `severity_overrides` key.
- **`guard_terms_extra`** adds terms to the keyword guard. The guard only vetoes *decreases*: when
  a rule would be demoted and its text mentions a guard term, the demotion is held back and the
  rule goes to the needs-decision list for you to approve or reject. A guard hit on a rule that
  stays the same or is promoted has no effect. Default terms can be extended but not removed —
  a noisy default costs you a few extra rows to decide, while a missing one could let a bulk run
  quietly demote a security or data rule.

Edits take effect on the next new run. A run in progress is pinned to the rubric snapshot it took
when it started, so resuming it keeps the old values. If the file is invalid, the skill stops and
names the file and the offending line, and lists the valid tags or severities when one of those
is wrong.

The full taxonomy, each tag's default, and the default guard terms are documented in
[references/rubric.md](skills/qodo-calibrate-rules/references/rubric.md); the header comment in
[references/rubric-defaults.yaml](skills/qodo-calibrate-rules/references/rubric-defaults.yaml)
carries the same list next to the schema.

## Maintainer and issues

Maintained by the Qodo team. Please report bugs, unexpected severities, and documentation problems
as issues on this repository.

## License

MIT — see [LICENSE](LICENSE).
