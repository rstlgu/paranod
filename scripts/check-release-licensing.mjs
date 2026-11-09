import fs from 'node:fs';
import assert from 'node:assert/strict';
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
assert.equal(pkg.license, 'AGPL-3.0-only');
assert.equal(
  JSON.parse(fs.readFileSync('services/container-runner/package.json', 'utf8'))
    .license,
  pkg.license
);
assert.equal(
  fs.readFileSync('LICENSE', 'utf8'),
  fs.readFileSync('public/license.txt', 'utf8')
);
assert.equal(
  fs.readFileSync('THIRD_PARTY_NOTICES.md', 'utf8'),
  fs.readFileSync('public/third-party-notices.txt', 'utf8')
);
assert.ok(
  fs
    .readFileSync('public/source.html', 'utf8')
    .includes(
      `releases/download/v${pkg.version}/paranod-source-v${pkg.version}.tar.gz`
    )
);
const inventory = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
// A new expression needs review; this is a release guard, not a legal opinion.
const reviewed = new Set([
  'MIT',
  'BlueOak-1.0.0',
  'Apache-2.0',
  'ISC',
  '0BSD',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '(AFL-2.1 OR BSD-3-Clause)',
  '(MIT OR CC0-1.0)',
  'MIT AND ISC',
  'CC-BY-4.0',
  'MPL-2.0',
  'LGPL-3.0-or-later'
]);
for (const license of Object.keys(inventory))
  assert.ok(
    reviewed.has(license),
    `Review dependency license before publication: ${license}`
  );
console.log(
  'PASS: application license, notices, source offer and reviewed dependency license expressions'
);
