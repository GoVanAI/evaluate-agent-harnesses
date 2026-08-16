---
name: evaluate-agent-harnesses
description: Design, initialize, run, compare, or improve vendor-neutral evaluation suites for coding-agent harnesses such as Codex CLI, Claude Code, or custom stdin-driven workers. Use for harness benchmarks, AGENTS.md or instruction regressions, skill and tool-routing tests, permission and recovery checks, model or reasoning comparisons, JSONL trace grading, deterministic safety gates, rubric judges, or evidence-gated agent improvement. Do not use for ordinary application unit tests, one-pass coding tasks, or unbounded autonomous loops.
---

# Evaluate Agent Harnesses

Build repeatable benchmarks in which the task contract and external graders—not the worker's self-report—determine success. Keep cases vendor-neutral and isolate provider-specific invocation behind adapters.

## Establish the evaluation boundary

Separate these roles:

- Let the operator own goals, consequential permissions, acceptance thresholds, and benchmark promotion.
- Let the suite own cases, fixtures, protected grader inputs, and hard gates.
- Let the runner own fresh workspaces, subprocess lifecycle, trace capture, scoring, and receipts.
- Let the worker inspect and mutate only its copied case workspace.
- Let deterministic graders establish mechanical facts.
- Let an independent judge or human assess qualities that cannot be encoded reliably.

Never let a provider output mark itself complete, rewrite grader inputs, relax a gate, expand permissions, or convert a weighted score into authority.

## Choose the operation

1. **Design a suite**: Read [eval-contract.md](references/eval-contract.md), define one user-visible promise, seed representative and failure cases, then choose deterministic gates before qualitative judges.
2. **Initialize a suite**: Run `node <skill-dir>/scripts/init-suite.mjs --output <path>`.
3. **Add or change an adapter**: Read [provider-adapters.md](references/provider-adapters.md) first. Preserve stdin prompts, argument arrays, fresh processes, explicit permissions, timeouts, and separate stdout/stderr capture.
4. **Run a suite**: Dry-run first, establish a baseline, then run the selected matrix.
5. **Compare harnesses**: Hold cases and graders constant while changing one dimension such as provider, model, reasoning effort, instructions, tools, or permissions.
6. **Improve a failing harness**: Make one focused change and rerun the entire relevant suite. Use `$loop-engineering` only when repeated bounded worker passes add value.

## Follow the mandatory agent workflow

Treat the generated suite directory as evaluation data. The runner remains in
this skill's `scripts/` directory; `init-suite.mjs` does not copy the runner or
create a root README. Never reinitialize a non-empty suite merely because those
files are absent.

### Gate 1 — Resolve and classify the suite

1. Resolve `<skill-dir>` from this loaded `SKILL.md` and `<suite>` from the
   operator's path or the current task.
2. If `<suite>/suite.json` exists, inspect it, its fixtures, graders, workers,
   and repository status. Do not run `init-suite.mjs` over it.
3. If no suite exists, choose a task-owned output path and initialize once.
4. Classify the result as either a controlled starter smoke or a meaningful
   benchmark. The generated `starter-harness-eval` with only `mock-worker` is a
   wiring smoke, not an agent evaluation.
5. Record execution identity as separate fields: orchestrating host, loaded
   skill path/hash, runner path/hash, suite path/digests, CLI adapter, and
   backend model. Do not infer the backend vendor from the adapter name.

**Acceptance:** every case, variant, hard gate, timeout, repetition count, and
forbidden effect is understood; protected grader inputs remain outside copied
worker fixtures.

**On failure:** stop in discovery. Do not run an unknown or ambiguous suite.

### Gate 2 — Validate the execution matrix

Run the exact suite with the skill-owned runner:

```powershell
node <skill-dir>\scripts\run-suite.mjs --suite <suite>\suite.json --dry-run
```

**Acceptance:** exit code 0; the printed case × variant × repetition matrix is
the intended matrix; suite and contract digests are recorded; no worker or
grader was invoked.

**On failure:** fix paths or contract structure only. Do not weaken cases,
graders, permissions, or thresholds to make validation pass.

### Gate 3 — Prove starter wiring before adding providers

For a newly generated starter, run only its controlled mock case first:

```powershell
node <skill-dir>\scripts\run-suite.mjs --suite <suite>\suite.json --case write-pass-artifact --variant mock-worker
```

Inspect `summary.json`, the run's `result.json`, logs, trace, and copied
workspace. Require score 100 and all four starter hard gates to pass.

**Acceptance:** subprocess, stdin prompt, fresh workspace, artifact grading,
forbidden-file gate, and receipt generation work end to end.

**On failure:** preserve the receipt and repair the runner or suite wiring.
Do not add Codex, Claude, or another real provider yet.

If the suite contains only this mock case after Gate 3, report **runner ready;
benchmark not yet authored** and stop unless the operator requested case or
provider authoring.

### Gate 4 — Calibrate real providers one at a time

Read [provider-adapters.md](references/provider-adapters.md) before adding or
changing a provider variant. Verify the provider executable and non-interactive
CLI locally, use least privilege, and keep provider mechanics out of cases.

For Claude Code with an operator-configured compatible backend, set the exact
backend identifier in the variant's `model` field. In this installation,
`provider: "claude"` may intentionally use `model: "MiniMax-M3"`; it does not
mean an Anthropic model. Never inherit or copy a decorated UI label such as
`MiniMax-M3[1m]`. The runner passes the clean value through `--model` and fails
closed on control characters, ANSI-like decorations, duplicate raw model args,
or unknown variant fields.

After another dry run, execute one selected case with one provider variant:

```powershell
node <skill-dir>\scripts\run-suite.mjs --suite <suite>\suite.json --case <case-id> --variant <variant-id>
```

Inspect the complete receipt before calibrating the next provider. A failed
calibration is evidence about that exact configuration, not permission to edit
the oracle.

**Acceptance:** invocation, permissions, timeout, working directory, trace
capability, and grader support are understood for each provider.

**On failure:** change one adapter or configuration dimension and rerun the
same unchanged case and graders. Stop for approval before broader permissions,
network use, paid judges, or bypass modes.

### Gate 5 — Establish and compare a fixed matrix

1. Freeze the reviewed suite and contract digests.
2. Run the baseline matrix before changing harness behavior.
3. Change exactly one declared dimension.
4. Rerun the same cases, graders, permissions, environment, and repetitions.
5. Compare receipts and inspect every hard-gate failure directly.

**Acceptance:** baseline and treatment are comparable, every required receipt
exists, no hard gate regresses, and any improvement claim names its exact
oracle and scope.

**On failure:** retain the result as evidence, reject the promotion claim, and
enter diagnosis or bounded recovery. Never relabel incomparable runs as an
experiment.

### Gate 6 — Report the evidence boundary

Report:

- suite and contract digests;
- selected cases, variants, repetitions, permissions, and environment;
- pass rate, hard-gate failures, scores, duration, usage, and unsupported
  telemetry;
- receipt locations and sanitized artifact evidence;
- the one changed dimension, if comparing runs; and
- limitations, open failures, and the next authorized action.

State what the suite does **not** prove. Passing the starter smoke proves runner
wiring only; it does not prove instruction adherence, skill routing, permission
discipline, recovery quality, or one provider's superiority.

## Initialize and run

Create a dependency-free starter suite:

```powershell
node <skill-dir>\scripts\init-suite.mjs --output .\harness-evals
```

The starter contains `suite.json`, `.gitignore`, one disposable fixture, one
external grader, and one mock worker. It intentionally contains no real Codex
or Claude case and no copy of the runner.

Inspect `suite.json`, fixtures, graders, and worker adapters before running. Preview commands without invoking workers or graders:

```powershell
node <skill-dir>\scripts\run-suite.mjs --suite .\harness-evals\suite.json --dry-run
```

Run the matrix:

```powershell
node <skill-dir>\scripts\run-suite.mjs --suite .\harness-evals\suite.json
```

Narrow calibration runs with `--case <id>` or `--variant <id>`. Do not treat a calibration run as regression coverage.

The runner creates a unique results directory and never reuses a worker workspace. Inspect:

- `summary.json` for matrix results, scores, gates, timing, and usage when available.
- Per-run `stdout.log` and `stderr.log` for raw provider output.
- Per-run `trace.jsonl` for normalized events.
- Per-run `result.json` for grader evidence and final status.
- The copied workspace for produced artifacts and diffs.

## Author trustworthy cases

Keep prompts about outcomes, not provider mechanics. Put provider flags only in `variants`. Every case should include:

- one bounded task;
- a disposable fixture;
- explicit forbidden effects;
- deterministic graders for mechanical requirements;
- hard gates for safety, authority, and protected behavior;
- optional weighted graders for quality;
- a timeout and enough repetitions to expose nondeterminism.

Start from sanitized bug reports, operator corrections, regressions, and recurring workflows. Maintain held-out cases when optimizing the harness so the worker cannot merely memorize the visible suite.

## Grade independently

Prefer built-in deterministic graders:

- `process_exit`
- `file_exists` / `file_not_exists`
- `file_contains`
- `stdout_contains`
- `trace_command_forbidden`
- `command`

Run custom verifiers as executable plus argument arrays with `shell: false`. Keep verifier code outside copied worker fixtures. A command grader may invoke an independent model judge, but require structured output, a fixed rubric, and explicit authorization for any network or paid call.

Use weighted scores only for tradeoffs. Mark safety, permission, forbidden-action, protected-input, and required-test checks as `hard_gate: true`; one failed hard gate fails the run regardless of aggregate score.

## Compare fairly

For each experiment:

1. Pin the suite and grader digests.
2. Record provider, model, harness version, instruction set, tools, permissions, and environment.
3. Run the baseline before changing behavior.
4. Change one harness dimension.
5. Rerun the same cases with the same repetition count.
6. Compare success rate, hard-gate failures, score, duration, usage, retries, and artifact quality.
7. Inspect failures directly; do not optimize only for the aggregate.
8. Promote a change only when evidence improves and no protected criterion regresses.

Treat provider traces as evidence, not ground truth. A missing trace event may mean the adapter cannot observe it; label the check unsupported instead of silently passing it.

## Preserve safety and privacy

- Use the least-privileged provider mode that can complete the case.
- Never use bypass-permission flags unless the operator explicitly authorizes an isolated environment.
- Keep credentials, customer data, and sensitive traces out of fixtures and committed results.
- Git-ignore raw results by default; promote only sanitized summaries deliberately.
- Do not run workers against a live production checkout or shared mutable service.
- Do not weaken cases or graders in response to a poor score without operator review.

## Validate this skill

After modifying its scripts or template, run:

```powershell
node <skill-dir>\scripts\test-runner.mjs
python <skill-creator-dir>\scripts\quick_validate.py <skill-dir>
```

Forward-test material workflow changes on fresh fixtures without giving the worker expected answers, suspected defects, or prior conclusions.
