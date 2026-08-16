# evaluate-agent-harnesses

Vendor-neutral agent-harness evaluation suite for Codex, Claude Code, and custom stdin workers. Authoritative entry point: [SKILL.md](./SKILL.md).

## Directory map

| Path | Purpose |
|------|---------|
| `SKILL.md` | Authoritative entry point. Read first. |
| `references/` | Three deep-dives: `eval-contract.md`, `eval-suite.schema.json`, `provider-adapters.md`. |
| `scripts/` | Runner code: `init-suite.mjs`, `run-suite.mjs`, `test-runner.mjs`. |
| `agents/` | Claude Code custom-agent interface (`openai.yaml`). |
| `assets/eval-suite-template/` | Init-suite source template (init-suite copies this into your workspace). |

This skill installs under your host's standard skills directory (e.g., `~/.claude/skills/<name>/` on Unix, `%USERPROFILE%\.claude\skills\<name>\` on Windows). The path is whatever your host uses; the structure above is what to look for.

## First 60 seconds for a new agent

1. Locate the `scripts/run-suite.mjs` file within your installation.
2. If you maintain a canonical evidence store, verify the runner's SHA-256 against your pinned value before invoking real calibrations.
3. Run a dry-run against your suite to confirm the runner accepts your environment:

```text
node scripts/run-suite.mjs --suite <your-suite>.json --case <id> --variant <id> --dry-run
```

Dry-run prints the execution matrix and digest freeze point with no worker invocation. Use the printed suite + contract digests as your experiment's freeze point. Run with `--help` for full options.

## What's NOT in this skill

This skill is for **harness-defined evaluation**. It is not:

- An ordinary unit-test framework (no test code, just case/grader contracts)
- A benchmark suite for arbitrary tasks (cases are designed per evidence gate)
- An autonomous-loop runner (a separate `loop-eng`-style skill plays that role for repeat-pass work)

For those, use the dedicated skills.

## Licensing and provenance

This README is a navigation layer; it does not introduce new policy. Source of truth for the skill's semantics is `SKILL.md`. Source of truth for empirical findings (SHA-256s, capability statements, drift-history) is your host's canonical evidence store.

MIT-licensed. See [LICENSE](./LICENSE) for the full copyright notice.
