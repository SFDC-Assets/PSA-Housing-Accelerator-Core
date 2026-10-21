#!/usr/bin/env node
/**
 * Non-destructively ensure the StandardValueSet values AHA needs exist on a target org.
 *
 * WHY THIS EXISTS
 * A StandardValueSet metadata deploy *replaces* the entire active value set — any value present
 * in the target org but NOT in the deployed file is deactivated. Shipping a static
 * standardValueSets/*.xml in the package would therefore clobber a customer org's own
 * Asset.Status / Location.LocationType values. So those files are .forceignore'd (kept only as the
 * canonical "values to ensure" list) and applied through this additive merge instead.
 *
 * WHAT IT DOES, per value set:
 *   1. read the canonical value list from the repo file
 *   2. retrieve the target org's CURRENT value set
 *   3. append only the canonical values that are missing (default=false, so an existing default is
 *      never disturbed), preserving every value already in the org
 *   4. deploy the merged value set back
 * No value is ever removed or deactivated.
 *
 * Run this BEFORE the package deploy — the Asset/Location record types reference these values.
 *
 * Usage:  node scripts/merge-standard-valuesets.mjs <org-alias>
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const org = process.argv[2];
if (!org) {
  console.error('Usage: node scripts/merge-standard-valuesets.mjs <org-alias>');
  process.exit(1);
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const svsDir = 'force-app/main/default/standardValueSets';
const VALUE_SETS = ['AssetStatus', 'LocationType']; // canonical files live in the repo under svsDir

// Extract the <fullName> of every <standardValue> block (ignores the outer element).
const valueNames = (xml) =>
  [...xml.matchAll(/<standardValue>[\s\S]*?<fullName>([^<]+)<\/fullName>/g)].map((m) => m[1]);

const run = (cmd) => execSync(cmd, { cwd: tmp, stdio: 'inherit' });

const tmp = mkdtempSync(join(tmpdir(), 'aha-svs-'));
writeFileSync(
  join(tmp, 'sfdx-project.json'),
  JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }], namespace: '', sourceApiVersion: '63.0' }, null, 2)
);
mkdirSync(join(tmp, 'force-app'), { recursive: true });

let changed = 0;
for (const name of VALUE_SETS) {
  const canonical = valueNames(readFileSync(join(repoRoot, svsDir, `${name}.standardValueSet-meta.xml`), 'utf8'));
  console.log(`\n[${name}] AHA requires: ${canonical.join(', ')}`);

  // 2. retrieve the org's current value set into the temp project
  run(`sf project retrieve start -m "StandardValueSet:${name}" -o ${org}`);
  const file = join(tmp, svsDir, `${name}.standardValueSet-meta.xml`);
  let xml = readFileSync(file, 'utf8');

  // 3. figure out what's missing and append it (preserving everything already there)
  const existing = new Set(valueNames(xml));
  const missing = canonical.filter((v) => !existing.has(v));
  if (missing.length === 0) {
    console.log(`[${name}] all required values already present — leaving org untouched`);
    continue;
  }
  console.log(`[${name}] adding (missing): ${missing.join(', ')}`);
  const blocks = missing
    .map((v) => `    <standardValue>\n        <fullName>${v}</fullName>\n        <default>false</default>\n        <label>${v}</label>\n    </standardValue>\n`)
    .join('');
  xml = xml.replace('</StandardValueSet>', `${blocks}</StandardValueSet>`);
  writeFileSync(file, xml);

  // 4. deploy the merged (additive) value set back
  run(`sf project deploy start -m "StandardValueSet:${name}" -o ${org} --wait 10`);
  console.log(`[${name}] merged + deployed (${missing.length} value(s) added, existing values preserved)`);
  changed++;
}

console.log(`\nDone. ${changed} value set(s) updated; no values were removed or deactivated.`);
console.log('You can now run the package deploy (sf project deploy start --manifest manifest/package.xml).');
