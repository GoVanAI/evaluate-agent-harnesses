# Provider adapters

## Contents

- [Common contract](#common-contract)
- [Codex CLI](#codex-cli)
- [Claude Code](#claude-code)
- [Custom workers](#custom-workers)
- [Normalized traces](#normalized-traces)
- [Adding a provider](#adding-a-provider)

## Common contract

Every adapter must:

1. start a fresh process for each run;
2. pass the task through stdin;
3. set the copied fixture as the working directory;
4. construct an executable and argument array without a shell;
5. use explicit least-privileged permission settings;
6. capture stdout and stderr separately;
7. enforce timeout and terminate the process tree;
8. return process facts and observable events without deciding success;
9. avoid session resumption by default; and
10. keep provider-specific fields out of cases and graders.

The runner owns lifecycle and scoring. A worker message such as “all tests pass” is ordinary output, never a verifier result.

## Codex CLI

Default invocation is equivalent to:

```text
codex exec --sandbox workspace-write --cd <workspace> --json -
```

The adapter may add `--model` and `--skip-git-repo-check` from reviewed variant fields. Do not use bypass-sandbox or bypass-approval options. JSONL events are normalized when `json` is enabled; raw output remains available.

The fixture should normally be a Git repository because Codex expects one. Use `skip_git_repo_check` only for a deliberately controlled fixture.

## Claude Code

Default invocation is equivalent to:

```text
claude --print --output-format text --permission-mode acceptEdits
```

Use another permission mode only when the suite explicitly requires it. Do not use permission-bypass modes outside an operator-authorized isolated environment. Text output yields process and message events; configure a structured output mode only after validating its current schema.

`provider: "claude"` names the Claude Code CLI adapter, not the backend vendor.
Claude Code may run through an operator-configured compatible backend such as
MiniMax M3. For that case, pin the reviewed backend identifier explicitly:

```json
{
  "id": "claude-m3-smoke",
  "provider": "claude",
  "model": "MiniMax-M3",
  "permission_mode": "acceptEdits",
  "output_format": "text"
}
```

The adapter emits `--model MiniMax-M3`; it does not restrict the identifier to
Anthropic model names. Never copy a terminal-decorated display label such as
`MiniMax-M3[1m]`. The runner rejects whitespace, control characters, ANSI-like
suffixes, raw `--model` duplication in `args`, and unknown variant fields.

Worker processes inherit the runner's parent environment before reviewed
variant `env` additions are applied. An explicit `model` field makes model
selection visible in the suite contract and overrides an inherited default at
the CLI boundary. Record three identities separately in the receipt or task
ledger: the orchestrating host, the CLI adapter, and the backend model.

## Custom workers

Custom adapters accept an executable and argument array:

```json
{
  "id": "worker-a",
  "provider": "custom",
  "command": "node",
  "args": ["{suite}/workers/worker-a.mjs"]
}
```

The runner supplies these environment variables:

- `HARNESS_EVAL_SUITE`
- `HARNESS_EVAL_CASE`
- `HARNESS_EVAL_VARIANT`
- `HARNESS_EVAL_RUN`
- `HARNESS_EVAL_WORKSPACE`

Use the custom adapter for other agent CLIs, controlled test workers, or wrappers that already enforce their own provider-specific policy.

## Normalized traces

Normalized events use this envelope:

```json
{
  "source": "codex",
  "type": "command_execution",
  "timestamp": null,
  "data": {}
}
```

The current runner recognizes Codex JSONL lifecycle and item events and extracts command executions plus usage. Claude and custom text output produce `provider_output` events unless a later adapter adds a validated parser.

Never infer that an unobserved event did not occur. A grader that requires unavailable telemetry must report `unsupported`.

## Adding a provider

Add a provider only with a stable non-interactive interface. Document:

- executable discovery;
- prompt transport;
- permission mapping;
- working-directory behavior;
- output and usage schema;
- timeout and process-tree termination behavior;
- redaction requirements; and
- unsupported grader capabilities.

Add a deterministic mock-provider test before claiming support. Keep adapter parsing tolerant of additional fields but strict about malformed required fields.
