#!/usr/bin/env node
// M0-T0 — Dual-track license CI check.
//
// Asserts every packages/*/package.json declares the correct SPDX license
// per the split recorded in ../LICENSE and DD §26.2 / §35 F14:
//
//   core, sim   → Apache-2.0
//   pwa, porch  → AGPL-3.0-only
//
// Also verifies the three canonical license files exist at repo root.
// Exits non-zero (with a per-package diff) on any drift.

import { readFile, access } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const weftRoot = resolve(scriptDir, '..');
const repoRoot = resolve(weftRoot, '..');
const packagesDir = join(weftRoot, 'packages');

const EXPECTED_BY_NAME = {
  core: 'Apache-2.0',
  sim: 'Apache-2.0',
  pwa: 'AGPL-3.0-only',
  porch: 'AGPL-3.0-only',
};

const REQUIRED_LICENSE_FILES = [
  'LICENSE',
  'LICENSE-APACHE-2.0',
  'LICENSE-AGPL-3.0',
];

const problems = [];

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// Check root license files exist.
for (const name of REQUIRED_LICENSE_FILES) {
  const path = join(repoRoot, name);
  if (!(await fileExists(path))) {
    problems.push(`missing license file: ${name} (expected at repo root)`);
  }
}

// Check each package's license field.
const packageNames = readdirSync(packagesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

for (const pkg of packageNames) {
  const expected = EXPECTED_BY_NAME[pkg];
  if (!expected) {
    problems.push(
      `unknown package "${pkg}" — add it to EXPECTED_BY_NAME in ${
        fileURLToPath(import.meta.url).replace(repoRoot + '\\', '').replace(repoRoot + '/', '')
      } (dual-track split is a governance decision, not a default)`,
    );
    continue;
  }

  const pkgJsonPath = join(packagesDir, pkg, 'package.json');
  if (!(await fileExists(pkgJsonPath))) {
    problems.push(`missing package.json: packages/${pkg}/package.json`);
    continue;
  }

  const raw = await readFile(pkgJsonPath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    problems.push(`invalid JSON: packages/${pkg}/package.json — ${err.message}`);
    continue;
  }

  const actual = parsed.license;
  if (actual !== expected) {
    problems.push(
      `packages/${pkg}/package.json: license = ${JSON.stringify(actual)}; expected ${JSON.stringify(expected)}`,
    );
  }
}

if (problems.length > 0) {
  console.error('License check FAILED:\n');
  for (const p of problems) console.error('  - ' + p);
  console.error(
    '\nThe dual-track license split is recorded in the repo-root LICENSE file and DD §26.2.',
  );
  process.exit(1);
}

console.log('License check OK:');
for (const pkg of packageNames) {
  console.log(`  packages/${pkg} → ${EXPECTED_BY_NAME[pkg]}`);
}
