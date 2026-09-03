# qodo-calibrate-rules

A coding-agent skill that re-levels the severity of every active Qodo Review Standard in your
workspace as one reviewable batch: it proposes a severity per rule from an editable rubric, you
approve, override, or skip each row, and only the approved rows are applied — then verified
against the live workspace, and revertible in a single step. `severity` is the only field it ever
writes.

To change one rule, use `qodo-manage-standards` instead.

## Prerequisites

**Qodo CLI**, installed and logged in:

```sh
qodo --version
qodo login
```

If it isn't installed, download the installer, verify it against the SHA-256 Qodo publishes for
it, then run it:

```sh
curl -fsSL https://get.qodo.ai/install.sh -o install.sh
sh install.sh
```

The skill probes the CLI version before it does anything and offers `qodo update` once if the
runtime is too old.

**Admin permission in the Qodo portal.** Severity changes are admin-gated on the platform, so your
workspace permission must be `owner` or `admin`. The skill checks this up front and stops with a
plain message for anyone else — a member can review a proposal but cannot apply it.

**Node.js 20 or newer.** The bundled scripts use Node built-ins only; there is nothing to
`npm install`.

## Install

```sh
npx skills add qodo-se/qodo-calibrate-rules
```

The installer asks which agents to install to, whether to install for the project or the user, and
whether to symlink or copy. The skill lands in `.agents/skills/qodo-calibrate-rules/`.

> **Preview.** This skill belongs to the `qodo-standards` family — that is what its
> `metadata.package` names — but it ships **ahead of** that package and is installed from this
> repository in the meantime. Once the official Qodo skills distribution carries it, install and
> update through that instead of here.

## Use it

Ask your agent to calibrate the workspace — *"recalibrate our review standards"*, *"too many rules
are errors"*, *"which rules should be errors vs warnings"*. It hands you a checklist of only the
rules whose severity would change, each with its current and proposed value and a link to the rule
in the portal. Edit that file in your editor or in the bundled browser page, say you're done, and
confirm; the skill applies the approved rows, re-reads the workspace to confirm each one landed,
and reports anything that didn't.

Afterwards you can ask it to check the workspace still matches the receipt, or to undo the whole
run.

Runs, the receipt, and your rubric live under `${QODO_HOME:-$HOME/.qodo}/calibrate/` — nothing is
written into a repository or the skill's install directory. `rubric.yaml` is created there on the
first run and never overwritten; edit it to change a category's default severity or extend the
keyword guard. The taxonomy and defaults are documented in
[references/rubric.md](skills/qodo-calibrate-rules/references/rubric.md), and the receipt grammar,
exit codes, and resume rules in
[references/receipt-format.md](skills/qodo-calibrate-rules/references/receipt-format.md).

**Windows.** The generated `apply.sh` and `revert.sh` are POSIX `sh` — run them under Git Bash or
WSL; there is no PowerShell equivalent. The rest of the workflow runs in PowerShell, but pass JSON
arguments through `--tags-file` rather than inline single quotes.

## Maintainer and issues

Maintained by the Qodo team. Please report bugs, unexpected severities, and documentation problems
as issues **on this repository** — that is where this preview is developed. Once the skill moves to
the official Qodo skills distribution, issue reporting moves with it.

## License

MIT — see [LICENSE](LICENSE).
