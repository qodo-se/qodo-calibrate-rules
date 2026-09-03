# Classifier subagent prompt

The orchestrator spawns one subagent per group of 1–2 batches with this prompt, placeholders
filled. The subagent runs in a fresh context: it is the only thing that ever reads rule text, and
it reports back one status line per batch. A Sonnet-class model is the right fit — the rubric is a
fixed lookup with a "common calls" table, and every decision is validated by the script.

Fill `<skill-dir>`, `<run-dir>`, and `<batches>` (e.g. `6 7`). Nothing else changes.

---

You are classifying Qodo Review Standards rules for a severity calibration. Work only inside
`<run-dir>`; write nothing anywhere else and run no `qodo` command.

**Read once:** `<skill-dir>/references/rubric.md` — the 13-tag taxonomy, each tag's default
severity, and the "Tagging: common calls" table. Keep it in mind for every rule.

**Then, for each batch number in `<batches>`, in order:**

1. Read `<run-dir>/batches/batch-NNN.txt` **in full** (NNN is the number zero-padded to 3 digits).
   Each rule is a header line `=== <ruleId> | <name> | category=<c> | severity=<s> | guard=<terms>`
   followed by its complete content. If the file is long, read it in parts; never skip a rule and
   never tag from the header alone.
2. For every rule decide, from its **content** together with its name and category, exactly one
   taxonomy tag. When two fit, choose the one with the higher default severity ("never log
   tokens" is `secrets-handling`, not `logging`; "validate request bodies against the schema" is
   `security-control`, not `api-contract`).
3. Write `<run-dir>/batches/batch-NNN.decisions.json`: `{"<ruleId>": "<tag>", ...}` with an
   entry for **every** rule in the batch (the `IDS=` trailer of the .txt file lists them).
4. Record it — one command:
   `node <skill-dir>/scripts/record-batch.mjs --run <run-dir> --batch N --tags-file <run-dir>/batches/batch-NNN.decisions.json`
   Exit 0 prints one JSON status line: keep it. Exit 2 means nothing was recorded and the message
   names each problem (a missing rule, an id not in the batch, an unknown tag): fix the decisions file and run the same command again. A status of
   `already_recorded` means another classifier already did this batch — move on.

Do not read `batch-NNN.json`, `export.json`, or `classification.jsonl`; the script validates
against them for you. Do not open the next batch before the current one is recorded.

**Reply with only** the final status JSON line of each batch you recorded, one per line, and a
one-line note for any batch you could not record and why. No rule text, no commentary.
