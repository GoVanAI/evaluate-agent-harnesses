#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const tempRoot = await realpath(os.tmpdir());
const tempDir = await mkdtemp(path.join(tempRoot, 'evaluate-agent-harnesses-'));

try {
  const suiteDir = path.join(tempDir, 'suite');
  const init = await run(process.execPath, [path.join(scriptDir, 'init-suite.mjs'), '--output', suiteDir], tempDir);
  if (init.code !== 0) throw new Error(`init-suite failed\n${init.stdout}\n${init.stderr}`);

  const dry = await run(process.execPath, [path.join(scriptDir, 'run-suite.mjs'), '--suite', path.join(suiteDir, 'suite.json'), '--dry-run'], tempDir);
  if (dry.code !== 0) throw new Error(`dry run failed\n${dry.stdout}\n${dry.stderr}`);
  const preview = JSON.parse(dry.stdout);
  if (preview.matrix.length !== 1 || preview.matrix[0].provider !== 'custom') throw new Error('Unexpected dry-run matrix');

  const suitePath = path.join(suiteDir, 'suite.json');
  const baseSuite = JSON.parse(await readFile(suitePath, 'utf8'));
  const adapterSuite = structuredClone(baseSuite);
  adapterSuite.variants = [
    { id: 'codex-dry', provider: 'codex', model: 'test-model', sandbox: 'read-only' },
    { id: 'claude-dry', provider: 'claude', model: 'MiniMax-M3', permission_mode: 'plan' },
    baseSuite.variants[0],
  ];
  const adapterSuitePath = path.join(tempDir, 'adapter-suite.json');
  await writeFile(adapterSuitePath, `${JSON.stringify(adapterSuite, null, 2)}\n`, 'utf8');
  const adapterDry = await run(process.execPath, [path.join(scriptDir, 'run-suite.mjs'), '--suite', adapterSuitePath, '--dry-run'], tempDir);
  if (adapterDry.code !== 0) throw new Error(`adapter dry run failed\n${adapterDry.stdout}\n${adapterDry.stderr}`);
  const adapterPreview = JSON.parse(adapterDry.stdout);
  const codex = adapterPreview.matrix.find((entry) => entry.variant === 'codex-dry');
  const claude = adapterPreview.matrix.find((entry) => entry.variant === 'claude-dry');
  if (codex.command !== 'codex' || !codex.args.includes('--json') || !codex.args.includes('test-model') || codex.args.at(-1) !== '-') {
    throw new Error('Codex adapter command is incorrect');
  }
  const claudeModelIndex = claude.args.indexOf('--model');
  if (claude.command !== 'claude' || !claude.args.includes('plan') || !claude.args.includes('text') || claudeModelIndex === -1 || claude.args[claudeModelIndex + 1] !== 'MiniMax-M3') {
    throw new Error('Claude adapter command is incorrect');
  }

  for (const badModel of ['MiniMax-M3[1m]', `MiniMax-M3\u001b[1m`]) {
    const invalidModelSuite = structuredClone(baseSuite);
    invalidModelSuite.variants = [{ id: 'claude-invalid-model', provider: 'claude', model: badModel }];
    const invalidModelPath = path.join(tempDir, `invalid-model-${Buffer.from(badModel).toString('hex')}.json`);
    await writeFile(invalidModelPath, `${JSON.stringify(invalidModelSuite, null, 2)}\n`, 'utf8');
    const invalidModel = await run(process.execPath, [path.join(scriptDir, 'run-suite.mjs'), '--suite', invalidModelPath, '--dry-run'], tempDir);
    if (invalidModel.code === 0 || !invalidModel.stderr.includes('model')) throw new Error('Decorated Claude model was not rejected');
  }

  const unknownVariantFieldSuite = structuredClone(baseSuite);
  unknownVariantFieldSuite.variants = [{ id: 'claude-unknown-field', provider: 'claude', model_name: 'MiniMax-M3' }];
  const unknownVariantFieldPath = path.join(tempDir, 'unknown-variant-field.json');
  await writeFile(unknownVariantFieldPath, `${JSON.stringify(unknownVariantFieldSuite, null, 2)}\n`, 'utf8');
  const unknownVariantField = await run(process.execPath, [path.join(scriptDir, 'run-suite.mjs'), '--suite', unknownVariantFieldPath, '--dry-run'], tempDir);
  if (unknownVariantField.code === 0 || !unknownVariantField.stderr.includes('Unknown field')) throw new Error('Unknown Claude variant field was not rejected');

  const resultsDir = path.join(tempDir, 'results');
  const actual = await run(process.execPath, [path.join(scriptDir, 'run-suite.mjs'), '--suite', path.join(suiteDir, 'suite.json'), '--results', resultsDir], tempDir);
  if (actual.code !== 0) throw new Error(`suite run failed\n${actual.stdout}\n${actual.stderr}`);
  const runSets = await readdir(resultsDir);
  if (runSets.length !== 1) throw new Error(`Expected one run set, found ${runSets.length}`);
  const summary = JSON.parse(await readFile(path.join(resultsDir, runSets[0], 'summary.json'), 'utf8'));
  if (!summary.passed || summary.passCount !== 1 || summary.failCount !== 0) throw new Error('Smoke suite did not pass');
  const result = summary.results[0];
  if (result.score !== 100 || !result.hardGatesPassed || result.graders.length !== 4) throw new Error('Unexpected grader result');

  const failingSuite = structuredClone(baseSuite);
  failingSuite.cases[0].graders.push({
    id: 'deliberate-hard-gate-failure',
    type: 'file_contains',
    path: 'answer.txt',
    contains: 'DOES-NOT-EXIST',
    hard_gate: true,
    weight: 0,
  });
  const failingSuitePath = path.join(suiteDir, 'failing-suite.json');
  await writeFile(failingSuitePath, `${JSON.stringify(failingSuite, null, 2)}\n`, 'utf8');
  const failureResultsDir = path.join(tempDir, 'failure-results');
  const failed = await run(process.execPath, [path.join(scriptDir, 'run-suite.mjs'), '--suite', failingSuitePath, '--results', failureResultsDir], tempDir);
  if (failed.code !== 1 || !failed.stdout.includes('FAILED')) throw new Error('Hard-gate failure did not fail the suite');

  const escapeSuite = structuredClone(baseSuite);
  escapeSuite.cases[0].fixture = '../outside-fixture';
  const escapeSuitePath = path.join(suiteDir, 'escape-suite.json');
  await writeFile(escapeSuitePath, `${JSON.stringify(escapeSuite, null, 2)}\n`, 'utf8');
  await mkdir(path.join(tempDir, 'outside-fixture'));
  const escaped = await run(process.execPath, [path.join(scriptDir, 'run-suite.mjs'), '--suite', escapeSuitePath, '--results', path.join(tempDir, 'escape-results')], tempDir);
  if (escaped.code === 0 || !escaped.stderr.includes('escapes allowed root')) throw new Error('Fixture path escape was not rejected');

  process.stdout.write('evaluate-agent-harnesses runner tests passed\n');
} finally {
  const resolved = path.resolve(tempDir);
  const relative = path.relative(tempRoot, resolved);
  if (relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative) && path.basename(resolved).startsWith('evaluate-agent-harnesses-')) {
    await rm(resolved, { recursive: true, force: true });
  }
}
