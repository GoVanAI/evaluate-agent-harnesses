#!/usr/bin/env node
import { cp, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function parseArgs(argv) {
  const parsed = { output: 'harness-evals' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--output') parsed.output = argv[++i];
    else if (arg === '--help' || arg === '-h') parsed.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!parsed.output) throw new Error('--output requires a path');
  return parsed;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  process.stdout.write('Usage: node init-suite.mjs [--output <directory>]\n');
  process.exit(0);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const templateDir = path.resolve(scriptDir, '..', 'assets', 'eval-suite-template');
const outputDir = path.resolve(args.output);

await mkdir(outputDir, { recursive: true });
const existing = await readdir(outputDir);
if (existing.length > 0) {
  throw new Error(`Refusing to initialize non-empty directory: ${outputDir}`);
}

await cp(templateDir, outputDir, { recursive: true, errorOnExist: true });
process.stdout.write(`Initialized harness evaluation suite at ${outputDir}\n`);
