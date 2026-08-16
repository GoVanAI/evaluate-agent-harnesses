#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { finished } from 'node:stream/promises';

const ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const MODEL_DECORATION_PATTERN = /\[[0-9;]*m\]?/;
const COMMON_VARIANT_FIELDS = new Set([
  'id', 'provider', 'command', 'args', 'env', 'timeout_ms', 'runs',
]);
const PROVIDER_VARIANT_FIELDS = {
  codex: new Set(['model', 'sandbox', 'json', 'skip_git_repo_check']),
  claude: new Set(['model', 'permission_mode', 'output_format']),
  custom: new Set(),
};

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--suite') parsed.suite = argv[++i];
    else if (arg === '--results') parsed.results = argv[++i];
    else if (arg === '--case') parsed.caseId = argv[++i];
    else if (arg === '--variant') parsed.variantId = argv[++i];
    else if (arg === '--dry-run') parsed.dryRun = true;
    else if (arg === '--help' || arg === '-h') parsed.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function usage() {
  return [
    'Usage: node run-suite.mjs --suite <suite.json> [options]',
    '  --results <directory>  Results root (default: <suite>/results)',
    '  --case <id>            Run one case',
    '  --variant <id>         Run one variant',
    '  --dry-run              Validate and print the execution matrix only',
  ].join('\n');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function uniqueIds(items, label) {
  const seen = new Set();
  for (const item of items) {
    assert(item && typeof item === 'object', `${label} entries must be objects`);
    assert(typeof item.id === 'string' && ID_PATTERN.test(item.id), `Invalid ${label} id: ${item.id}`);
    assert(!seen.has(item.id), `Duplicate ${label} id: ${item.id}`);
    seen.add(item.id);
  }
}

function validateModelIdentifier(model, variantId) {
  assert(typeof model === 'string' && model.length > 0, `Variant ${variantId} model must be a non-empty string`);
  assert(model === model.trim(), `Variant ${variantId} model must not have surrounding whitespace`);
  assert(!/\s|[\u0000-\u001F\u007F]/u.test(model), `Variant ${variantId} model must be a clean identifier without whitespace or control characters`);
  assert(!MODEL_DECORATION_PATTERN.test(model), `Variant ${variantId} model looks like a decorated display label; use the backend's exact identifier`);
}

function validateVariant(variant) {
  const providerFields = PROVIDER_VARIANT_FIELDS[variant.provider];
  assert(providerFields, `Unsupported provider: ${variant.provider}`);
  const allowed = new Set([...COMMON_VARIANT_FIELDS, ...providerFields]);
  for (const key of Object.keys(variant)) {
    assert(allowed.has(key), `Unknown field for ${variant.provider} variant ${variant.id}: ${key}`);
  }
  if (variant.command !== undefined) assert(typeof variant.command === 'string' && variant.command.length > 0, `Variant ${variant.id} command must be a non-empty string`);
  if (variant.args !== undefined) {
    assert(Array.isArray(variant.args) && variant.args.every((value) => typeof value === 'string'), `Variant ${variant.id} args must be strings`);
    assert(!variant.args.some((value) => value === '--model' || value.startsWith('--model=')), `Variant ${variant.id} must use the model field instead of a raw --model argument`);
  }
  if (variant.env !== undefined) {
    assert(variant.env && typeof variant.env === 'object' && !Array.isArray(variant.env), `Variant ${variant.id} env must be an object`);
    assert(Object.values(variant.env).every((value) => typeof value === 'string'), `Variant ${variant.id} env values must be strings`);
  }
  if (variant.timeout_ms !== undefined) assert(Number.isInteger(variant.timeout_ms) && variant.timeout_ms > 0, `Variant ${variant.id} timeout_ms must be a positive integer`);
  if (variant.runs !== undefined) assert(Number.isInteger(variant.runs) && variant.runs > 0, `Variant ${variant.id} runs must be a positive integer`);
  if (variant.model !== undefined) validateModelIdentifier(variant.model, variant.id);

  if (variant.provider === 'custom') {
    assert(typeof variant.command === 'string' && variant.command.length > 0, `Custom variant ${variant.id} requires command`);
  } else if (variant.provider === 'codex') {
    if (variant.sandbox !== undefined) assert(['read-only', 'workspace-write'].includes(variant.sandbox), `Variant ${variant.id} has unsupported Codex sandbox`);
    if (variant.json !== undefined) assert(typeof variant.json === 'boolean', `Variant ${variant.id} json must be boolean`);
    if (variant.skip_git_repo_check !== undefined) assert(typeof variant.skip_git_repo_check === 'boolean', `Variant ${variant.id} skip_git_repo_check must be boolean`);
  } else {
    if (variant.permission_mode !== undefined) assert(['acceptEdits', 'auto', 'bypassPermissions', 'manual', 'dontAsk', 'plan'].includes(variant.permission_mode), `Variant ${variant.id} has unsupported Claude permission_mode`);
    if (variant.output_format !== undefined) assert(['text', 'json', 'stream-json'].includes(variant.output_format), `Variant ${variant.id} has unsupported Claude output_format`);
  }
}

function validateSuite(suite) {
  assert(suite && typeof suite === 'object', 'Suite must be a JSON object');
  assert(suite.schema_version === 1, 'schema_version must be 1');
  assert(typeof suite.name === 'string' && suite.name.length > 0, 'name is required');
  assert(Array.isArray(suite.variants) && suite.variants.length > 0, 'variants must be non-empty');
  assert(Array.isArray(suite.cases) && suite.cases.length > 0, 'cases must be non-empty');
  uniqueIds(suite.variants, 'variant');
  uniqueIds(suite.cases, 'case');
  for (const variant of suite.variants) {
    validateVariant(variant);
  }
  for (const testCase of suite.cases) {
    assert(typeof testCase.fixture === 'string' && testCase.fixture, `Case ${testCase.id} requires fixture`);
    assert(typeof testCase.prompt === 'string' && testCase.prompt, `Case ${testCase.id} requires prompt`);
    assert(Array.isArray(testCase.graders) && testCase.graders.length > 0, `Case ${testCase.id} requires graders`);
    uniqueIds(testCase.graders, `grader in ${testCase.id}`);
  }
}

function resolveInside(root, candidate, label) {
  const rootPath = path.resolve(root);
  const target = path.resolve(rootPath, candidate);
  const relative = path.relative(rootPath, target);
  assert(relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), `${label} escapes allowed root`);
  return target;
}

function replaceTokens(value, tokens) {
  assert(typeof value === 'string', 'Tokenized values must be strings');
  return value.replace(/\{(suite|workspace|run|case|variant)\}/g, (_, key) => tokens[key]);
}

async function rejectSymlinks(root) {
  const rootStat = await lstat(root);
  assert(!rootStat.isSymbolicLink(), `Fixture root may not be a symlink: ${root}`);
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    const info = await lstat(fullPath);
    assert(!info.isSymbolicLink(), `Fixture symlinks are not allowed: ${fullPath}`);
    if (info.isDirectory()) await rejectSymlinks(fullPath);
  }
}

async function digestTree(root, excludedRoot) {
  const hash = createHash('sha256');
  async function visit(current) {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (excludedRoot && path.resolve(fullPath) === path.resolve(excludedRoot)) continue;
      const info = await lstat(fullPath);
      assert(!info.isSymbolicLink(), `Evaluation contract symlinks are not allowed: ${fullPath}`);
      const relative = path.relative(root, fullPath).split(path.sep).join('/');
      hash.update(relative);
      hash.update('\0');
      if (info.isDirectory()) {
        hash.update('directory\0');
        await visit(fullPath);
      } else if (info.isFile()) {
        hash.update('file\0');
        hash.update(await readFile(fullPath));
        hash.update('\0');
      } else {
        throw new Error(`Unsupported contract entry type: ${fullPath}`);
      }
    }
  }
  await visit(root);
  return hash.digest('hex');
}

function buildProviderCommand(variant, tokens) {
  const extra = (variant.args || []).map((arg) => replaceTokens(arg, tokens));
  if (variant.provider === 'custom') {
    return { command: replaceTokens(variant.command, tokens), args: extra };
  }
  if (variant.provider === 'codex') {
    const args = ['exec', '--sandbox', variant.sandbox || 'workspace-write', '--cd', tokens.workspace];
    if (variant.model) args.push('--model', variant.model);
    if (variant.skip_git_repo_check) args.push('--skip-git-repo-check');
    if (variant.json !== false) args.push('--json');
    args.push(...extra, '-');
    return { command: variant.command || 'codex', args };
  }
  const args = ['--print', '--output-format', variant.output_format || 'text', '--permission-mode', variant.permission_mode || 'acceptEdits'];
  if (variant.model) args.push('--model', variant.model);
  args.push(...extra);
  return { command: variant.command || 'claude', args };
}

async function terminateTree(child, graceMs) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { shell: false, stdio: 'ignore' });
      killer.on('error', resolve);
      killer.on('exit', resolve);
    });
    return;
  }
  try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  await new Promise((resolve) => setTimeout(resolve, graceMs));
  try { process.kill(-child.pid, 'SIGKILL'); } catch {}
}

async function runProcess({ command, args, cwd, env, input, timeoutMs, graceMs, stdoutPath, stderrPath, maxCaptureBytes }) {
  await mkdir(path.dirname(stdoutPath), { recursive: true });
  const stdoutFile = createWriteStream(stdoutPath, { flags: 'wx' });
  const stderrFile = createWriteStream(stderrPath, { flags: 'wx' });
  const stdoutFinished = finished(stdoutFile);
  const stderrFinished = finished(stderrFile);
  const stdoutChunks = [];
  const stderrChunks = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let timedOut = false;
  const started = Date.now();

  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    shell: false,
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  child.stdout.pipe(stdoutFile);
  child.stderr.pipe(stderrFile);
  child.stdout.on('data', (chunk) => {
    if (stdoutBytes < maxCaptureBytes) {
      const remaining = maxCaptureBytes - stdoutBytes;
      stdoutChunks.push(chunk.subarray(0, remaining));
      stdoutBytes += Math.min(chunk.length, remaining);
    }
  });
  child.stderr.on('data', (chunk) => {
    if (stderrBytes < maxCaptureBytes) {
      const remaining = maxCaptureBytes - stderrBytes;
      stderrChunks.push(chunk.subarray(0, remaining));
      stderrBytes += Math.min(chunk.length, remaining);
    }
  });

  child.stdin.end(input);
  const timer = setTimeout(async () => {
    timedOut = true;
    await terminateTree(child, graceMs);
  }, timeoutMs);

  const outcome = await new Promise((resolve) => {
    child.on('error', (error) => resolve({ exitCode: null, signal: null, error: error.message }));
    child.on('exit', (exitCode, signal) => resolve({ exitCode, signal, error: null }));
  });
  clearTimeout(timer);
  await Promise.all([stdoutFinished, stderrFinished]);

  return {
    ...outcome,
    timedOut,
    durationMs: Date.now() - started,
    stdout: Buffer.concat(stdoutChunks).toString('utf8'),
    stderr: Buffer.concat(stderrChunks).toString('utf8'),
    stdoutTruncated: stdoutBytes >= maxCaptureBytes,
    stderrTruncated: stderrBytes >= maxCaptureBytes,
  };
}

function normalizeTrace(provider, stdout) {
  if (provider !== 'codex') {
    return stdout ? [{ source: provider, type: 'provider_output', timestamp: null, data: { text: stdout } }] : [];
  }
  const events = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const raw = JSON.parse(line);
      const item = raw.item || {};
      events.push({
        source: 'codex',
        type: item.type || raw.type || 'unknown',
        timestamp: null,
        data: raw,
      });
    } catch {
      events.push({ source: 'codex', type: 'unparsed_output', timestamp: null, data: { text: line } });
    }
  }
  return events;
}

function extractUsage(events) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const usage = events[i]?.data?.usage;
    if (usage && typeof usage === 'object') return usage;
  }
  return null;
}

function commandTexts(events) {
  const commands = [];
  for (const event of events) {
    const item = event.data?.item;
    if (item?.type === 'command_execution' && typeof item.command === 'string') commands.push(item.command);
  }
  return commands;
}

async function runGrader(grader, context) {
  const weight = grader.weight ?? 1;
  const hardGate = grader.hard_gate === true;
  const base = { id: grader.id, type: grader.type, weight, hardGate };
  const pass = (evidence) => ({ ...base, status: 'passed', score: 1, evidence });
  const fail = (evidence) => ({ ...base, status: 'failed', score: 0, evidence });
  const unsupported = (evidence) => ({ ...base, status: 'unsupported', score: null, evidence });

  if (grader.type === 'process_exit') {
    const expected = grader.expected ?? 0;
    return context.process.exitCode === expected && !context.process.timedOut
      ? pass({ expected, actual: context.process.exitCode, timedOut: context.process.timedOut })
      : fail({ expected, actual: context.process.exitCode, timedOut: context.process.timedOut, error: context.process.error });
  }
  if (['file_exists', 'file_not_exists', 'file_contains'].includes(grader.type)) {
    const target = resolveInside(context.workspace, grader.path, `Grader ${grader.id} path`);
    let exists = true;
    try { await stat(target); } catch (error) { if (error.code === 'ENOENT') exists = false; else throw error; }
    if (grader.type === 'file_exists') return exists ? pass({ path: target }) : fail({ path: target });
    if (grader.type === 'file_not_exists') return !exists ? pass({ path: target }) : fail({ path: target });
    if (!exists) return fail({ path: target, reason: 'missing' });
    const content = await readFile(target, 'utf8');
    return content.includes(grader.contains) ? pass({ path: target, contains: grader.contains }) : fail({ path: target, contains: grader.contains });
  }
  if (grader.type === 'stdout_contains') {
    return context.process.stdout.includes(grader.contains) ? pass({ contains: grader.contains }) : fail({ contains: grader.contains });
  }
  if (grader.type === 'trace_command_forbidden') {
    if (context.provider !== 'codex') return unsupported({ reason: `Provider ${context.provider} exposes no normalized command trace` });
    let pattern;
    try { pattern = new RegExp(grader.pattern, grader.flags || ''); } catch (error) { throw new Error(`Invalid regex in grader ${grader.id}: ${error.message}`); }
    const matches = commandTexts(context.events).filter((command) => pattern.test(command));
    return matches.length === 0 ? pass({ pattern: grader.pattern }) : fail({ pattern: grader.pattern, matches });
  }
  if (grader.type === 'command') {
    const tokens = context.tokens;
    const command = replaceTokens(grader.command, tokens);
    const args = (grader.args || []).map((arg) => replaceTokens(arg, tokens));
    const cwd = grader.cwd ? replaceTokens(grader.cwd, tokens) : context.workspace;
    const stdoutPath = path.join(context.runDir, `grader-${grader.id}-stdout.log`);
    const stderrPath = path.join(context.runDir, `grader-${grader.id}-stderr.log`);
    const result = await runProcess({
      command,
      args,
      cwd,
      env: {},
      input: '',
      timeoutMs: grader.timeout_ms || context.graderTimeoutMs,
      graceMs: context.graceMs,
      stdoutPath,
      stderrPath,
      maxCaptureBytes: context.maxCaptureBytes,
    });
    const expected = grader.expected_exit ?? 0;
    const evidence = { command, args, cwd, expected, actual: result.exitCode, timedOut: result.timedOut, stdoutPath, stderrPath };
    return result.exitCode === expected && !result.timedOut ? pass(evidence) : fail({ ...evidence, error: result.error });
  }
  throw new Error(`Unsupported grader type: ${grader.type}`);
}

function redactVariant(variant) {
  const copy = structuredClone(variant);
  if (copy.env) {
    for (const key of Object.keys(copy.env)) copy.env[key] = '<redacted>';
  }
  return copy;
}

const cli = parseArgs(process.argv.slice(2));
if (cli.help) {
  process.stdout.write(`${usage()}\n`);
  process.exit(0);
}
assert(cli.suite, '--suite is required');

const suitePath = path.resolve(cli.suite);
const suiteDir = path.dirname(suitePath);
const rawSuite = await readFile(suitePath, 'utf8');
const suite = JSON.parse(rawSuite);
validateSuite(suite);
const suiteDigest = createHash('sha256').update(rawSuite).digest('hex');
const resultsRoot = path.resolve(cli.results || path.join(suiteDir, 'results'));
const contractDigest = await digestTree(suiteDir, resultsRoot);

let variants = suite.variants;
let cases = suite.cases;
if (cli.variantId) variants = variants.filter((variant) => variant.id === cli.variantId);
if (cli.caseId) cases = cases.filter((testCase) => testCase.id === cli.caseId);
assert(variants.length > 0, `No matching variant: ${cli.variantId}`);
assert(cases.length > 0, `No matching case: ${cli.caseId}`);

const defaults = {
  timeout_ms: 600000,
  grader_timeout_ms: 60000,
  kill_grace_ms: 3000,
  runs: 1,
  max_capture_bytes: 5242880,
  ...(suite.defaults || {}),
};

const matrix = [];
for (const variant of variants) {
  for (const testCase of cases) {
    const repetitions = testCase.runs || variant.runs || defaults.runs;
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      matrix.push({ variant, testCase, repetition });
    }
  }
}

if (cli.dryRun) {
  const preview = matrix.map(({ variant, testCase, repetition }) => {
    const tokens = { suite: suiteDir, workspace: '<fresh-workspace>', run: '<run-directory>', case: testCase.id, variant: variant.id };
    return { case: testCase.id, variant: variant.id, repetition, provider: variant.provider, ...buildProviderCommand(variant, tokens) };
  });
  process.stdout.write(`${JSON.stringify({ suite: suite.name, suiteDigest, contractDigest, matrix: preview }, null, 2)}\n`);
  process.exit(0);
}

await mkdir(resultsRoot, { recursive: true });
const runSetId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
const runSetDir = path.join(resultsRoot, runSetId);
await mkdir(runSetDir, { recursive: false });

const summary = {
  schemaVersion: 1,
  suite: suite.name,
  suitePath,
  suiteDigest,
  contractDigest,
  runSetId,
  startedAt: new Date().toISOString(),
  platform: { os: process.platform, arch: process.arch, node: process.version, hostname: os.hostname() },
  results: [],
};

for (const { variant, testCase, repetition } of matrix) {
  const runId = `${testCase.id}__${variant.id}__${repetition}`;
  const runDir = path.join(runSetDir, runId);
  const workspace = path.join(runDir, 'workspace');
  await mkdir(runDir, { recursive: false });
  const fixture = resolveInside(suiteDir, testCase.fixture, `Case ${testCase.id} fixture`);
  const fixtureReal = await realpath(fixture);
  const suiteReal = await realpath(suiteDir);
  const relativeFixture = path.relative(suiteReal, fixtureReal);
  assert(relativeFixture !== '..' && !relativeFixture.startsWith(`..${path.sep}`) && !path.isAbsolute(relativeFixture), `Case ${testCase.id} fixture resolves outside suite`);
  await rejectSymlinks(fixtureReal);
  await cp(fixtureReal, workspace, { recursive: true, errorOnExist: true });

  const tokens = { suite: suiteDir, workspace, run: runDir, case: testCase.id, variant: variant.id };
  const providerCommand = buildProviderCommand(variant, tokens);
  const providerEnv = {
    ...(variant.env || {}),
    HARNESS_EVAL_SUITE: suite.name,
    HARNESS_EVAL_CASE: testCase.id,
    HARNESS_EVAL_VARIANT: variant.id,
    HARNESS_EVAL_RUN: String(repetition),
    HARNESS_EVAL_WORKSPACE: workspace,
  };
  const stdoutPath = path.join(runDir, 'stdout.log');
  const stderrPath = path.join(runDir, 'stderr.log');
  const processResult = await runProcess({
    command: providerCommand.command,
    args: providerCommand.args,
    cwd: workspace,
    env: providerEnv,
    input: testCase.prompt,
    timeoutMs: testCase.timeout_ms || variant.timeout_ms || defaults.timeout_ms,
    graceMs: defaults.kill_grace_ms,
    stdoutPath,
    stderrPath,
    maxCaptureBytes: defaults.max_capture_bytes,
  });
  const events = normalizeTrace(variant.provider, processResult.stdout);
  const tracePath = path.join(runDir, 'trace.jsonl');
  await writeFile(tracePath, events.map((event) => JSON.stringify(event)).join('\n') + (events.length ? '\n' : ''), { encoding: 'utf8', flag: 'wx' });

  const graderContext = {
    provider: variant.provider,
    process: processResult,
    events,
    workspace,
    runDir,
    tokens,
    graderTimeoutMs: defaults.grader_timeout_ms,
    graceMs: defaults.kill_grace_ms,
    maxCaptureBytes: defaults.max_capture_bytes,
  };
  const graders = [];
  for (const grader of testCase.graders) graders.push(await runGrader(grader, graderContext));
  const supportedWeighted = graders.filter((grader) => grader.weight > 0 && grader.status !== 'unsupported');
  const unsupportedWeighted = graders.filter((grader) => grader.weight > 0 && grader.status === 'unsupported');
  const totalWeight = supportedWeighted.reduce((sum, grader) => sum + grader.weight, 0);
  const earned = supportedWeighted.reduce((sum, grader) => sum + grader.weight * grader.score, 0);
  const score = totalWeight > 0 ? (earned / totalWeight) * 100 : 0;
  const hardGatesPassed = graders.filter((grader) => grader.hardGate).every((grader) => grader.status === 'passed');
  const minimumScore = testCase.minimum_score ?? 100;
  const status = hardGatesPassed && unsupportedWeighted.length === 0 && score >= minimumScore ? 'passed' : 'failed';
  const result = {
    runId,
    caseId: testCase.id,
    variantId: variant.id,
    repetition,
    provider: variant.provider,
    variant: redactVariant(variant),
    command: providerCommand,
    workspace,
    stdoutPath,
    stderrPath,
    tracePath,
    process: { ...processResult, stdout: undefined, stderr: undefined },
    usage: extractUsage(events),
    graders,
    score,
    minimumScore,
    hardGatesPassed,
    status,
  };
  await writeFile(path.join(runDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  summary.results.push(result);
  process.stdout.write(`${status.toUpperCase()} ${runId} score=${score.toFixed(1)} hard_gates=${hardGatesPassed}\n`);
}

summary.completedAt = new Date().toISOString();
summary.passed = summary.results.every((result) => result.status === 'passed');
summary.passCount = summary.results.filter((result) => result.status === 'passed').length;
summary.failCount = summary.results.length - summary.passCount;
await writeFile(path.join(runSetDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
process.stdout.write(`Summary: ${path.join(runSetDir, 'summary.json')}\n`);
if (!summary.passed) process.exitCode = 1;
