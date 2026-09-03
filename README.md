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
written into a repository or the skill's install directory. `rubric.yaml` is created on the
first run and never overwritten; edit it to change a taxonomy tag's default severity or extend the
keyword guard. The taxonomy and defaults are documented in
[references/rubric.md](skills/qodo-calibrate-rules/references/rubric.md), and the receipt grammar,
exit codes, and resume rules in
[references/receipt-format.md](skills/qodo-calibrate-rules/references/receipt-format.md).

## Maintainer and issues

Maintained by the Qodo team. Please report bugs, unexpected severities, and documentation problems
as issues on this repository.

## License

MIT — see [LICENSE](LICENSE).
