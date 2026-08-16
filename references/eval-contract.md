# Evaluation contract

## Contents

- [Design rules](#design-rules)
- [Suite fields](#suite-fields)
- [Variant fields](#variant-fields)
- [Case fields](#case-fields)
- [Grader fields](#grader-fields)
- [Scoring](#scoring)
- [Receipts](#receipts)

## Design rules

An evaluation suite is an operator-reviewed JSON contract. Keep it independent of any provider's prompt syntax or trace format. The runner validates the contract before starting a worker.

Use fresh copied workspaces. The source fixture, suite definition, and verifier programs remain outside worker-writable paths. Never accept a worker-created test as proof for the same run.

## Suite fields

Required:

- `schema_version`: currently `1`.
- `name`: stable suite name.
- `variants`: non-empty array of harness configurations.
- `cases`: non-empty array of tasks.

Optional:

- `defaults.timeout_ms`: worker timeout; default `600000`.
- `defaults.grader_timeout_ms`: command-grader timeout; default `60000`.
- `defaults.kill_grace_ms`: termination grace; default `3000`.
- `defaults.runs`: repetitions per case and variant; default `1`.
- `defaults.max_capture_bytes`: in-memory trace parsing limit; raw logs continue streaming to disk; default `5242880`.

IDs must contain only letters, digits, dots, underscores, or hyphens and must be unique within their collection.

## Variant fields

Required:

- `id`: stable matrix identifier.
- `provider`: `codex`, `claude`, or `custom`.

Common optional fields:

- `command`: executable override.
- `args`: additional or complete argument array as defined by the adapter.
- `env`: explicit environment additions. Do not store secrets in the suite.
- `timeout_ms`: variant timeout override.
- `runs`: repetition override.
- `model`: exact backend model identifier passed through `--model` for Codex
  or Claude CLI variants. It is an opaque backend identifier, not a vendor
  assumption. Use `MiniMax-M3` when that is the reviewed Claude-compatible
  backend. Whitespace, control characters, ANSI decorations, and display labels
  such as `MiniMax-M3[1m]` are rejected. Custom variants do not accept it.

Codex fields:

- `sandbox`: `read-only` or `workspace-write`; default `workspace-write`.
- `json`: capture Codex JSONL; default `true`.
- `skip_git_repo_check`: default `false`.

Claude fields:

- `permission_mode`: default `acceptEdits`.
- `output_format`: default `text`.

For Claude Code running through a non-Anthropic compatible backend, set
`model` explicitly. `provider: "claude"` identifies the CLI adapter; it does
not assert that the backend model is Anthropic.

Custom fields:

- `command`: required executable.
- `args`: complete argument array, default empty.

Read `provider-adapters.md` before changing adapter behavior.

## Case fields

Required:

- `id`: stable case identifier.
- `fixture`: directory relative to the suite file.
- `prompt`: task sent to the worker through stdin.
- `graders`: non-empty array.

Optional:

- `runs`: case repetition override.
- `timeout_ms`: case worker timeout override.
- `tags`: descriptive strings for later filtering.

Paths must resolve under the suite directory. Symlinks are rejected in fixtures so a copied workspace cannot smuggle references to protected host paths.

## Grader fields

All graders require:

- `id`: unique within the case.
- `type`: grader type.

Common optional fields:

- `hard_gate`: default `false`.
- `weight`: non-negative number, default `1`.

Types:

### `process_exit`

- `expected`: expected worker exit code, default `0`.

### `file_exists` and `file_not_exists`

- `path`: path relative to the copied workspace.

### `file_contains`

- `path`: path relative to the copied workspace.
- `contains`: literal required text.

### `stdout_contains`

- `contains`: literal required text in provider stdout.

### `trace_command_forbidden`

- `pattern`: JavaScript regular expression tested against normalized command-execution events.
- `flags`: optional regular-expression flags.

If the adapter exposes no command events, the grader reports `unsupported` and does not silently pass. Make it a hard gate only for variants that expose the required trace.

### `command`

- `command`: verifier executable.
- `args`: argument array.
- `cwd`: optional tokenized directory; default `{workspace}`.
- `expected_exit`: default `0`.
- `timeout_ms`: grader timeout override.

Tokens supported in executable arguments and `cwd`:

- `{suite}`: suite directory.
- `{workspace}`: copied worker workspace.
- `{run}`: run artifact directory.
- `{case}`: case ID.
- `{variant}`: variant ID.

Commands use argument arrays and `shell: false`.

## Scoring

Each supported grader returns `score` of `0` or `1`. The run score is the weighted mean multiplied by 100. Unsupported zero-weight graders are diagnostic only. An unsupported positive-weight grader makes the run incomplete.

A run passes only when:

1. every hard gate passes;
2. no positive-weight grader is unsupported; and
3. the weighted score meets `case.minimum_score`, default `100`.

Provider exit status is not implicitly authoritative. Include a `process_exit` grader when it matters.

## Receipts

Every invocation creates a unique immutable-by-convention result directory containing:

- a suite digest;
- a contract-tree digest covering suite-local fixtures, workers, and graders while excluding the results directory;
- runtime and platform metadata;
- selected case and variant configuration with secrets redacted;
- raw stdout and stderr;
- normalized trace events;
- grader evidence;
- scores, gates, duration, timeout state, and usage when exposed.

Raw traces may contain sensitive data. Results are ignored by the starter template and should be sanitized before sharing or committing.
