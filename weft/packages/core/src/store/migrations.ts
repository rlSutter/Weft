// Schema migrations — DD §35 F12, Fable review L14.
//
// Local-first apps die of schema drift; the discipline is `schema_version`
// row + forward-only migrations that each transform "fixture DB at N-1" to
// "fixture DB at N", tested in CI. This module holds the migration table;
// individual adapter classes call `runMigrations(from, to)` at open time.

import { CURRENT_SCHEMA_VERSION } from './types';

export type MigrationStep = (state: unknown) => unknown;

/**
 * Migration table — an entry for each transition from version N-1 to N.
 * Empty until v0 ships its first schema and needs one. The API is here so
 * every adapter has the same seam ready.
 */
export const MIGRATIONS: ReadonlyArray<{ from: number; to: number; run: MigrationStep }> = Object.freeze([
  // Example (do not enable): { from: 1, to: 2, run: (s) => addFieldXToContacts(s) },
]);

/**
 * Run forward-only migrations from `fromVersion` to `CURRENT_SCHEMA_VERSION`.
 * Throws if a step is missing — refusing to run against an unknown schema is
 * safer than partial-migrating.
 */
export function planMigrations(fromVersion: number, toVersion: number = CURRENT_SCHEMA_VERSION): MigrationStep[] {
  if (fromVersion === toVersion) return [];
  if (fromVersion > toVersion) {
    throw new Error(
      `schema_version ${fromVersion} is newer than this client (${toVersion}); refuse to open`,
    );
  }
  const plan: MigrationStep[] = [];
  let cursor = fromVersion;
  while (cursor < toVersion) {
    const step = MIGRATIONS.find((m) => m.from === cursor);
    if (!step) {
      throw new Error(`missing migration from schema_version ${cursor} to ${cursor + 1}`);
    }
    plan.push(step.run);
    cursor = step.to;
  }
  return plan;
}
