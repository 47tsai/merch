#!/usr/bin/env node

import fs from 'node:fs/promises';

const packagePath = 'package.json';
const lockPath = 'package-lock.json';
const versionPath = 'public/data/version.json';

const packageJson = JSON.parse(await fs.readFile(packagePath, 'utf8'));
const packageLock = JSON.parse(await fs.readFile(lockPath, 'utf8'));
const version = String(packageJson.version || '');

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`Version sync failed: package.json has an invalid version: ${version || '(empty)'}.`);
  process.exit(1);
}

const content = `${JSON.stringify({ version }, null, 2)}\n`;
await fs.writeFile(versionPath, content, 'utf8');

if (!packageLock.packages?.['']) {
  throw new Error('Version sync failed: package-lock.json is missing its root package entry.');
}
packageLock.version = version;
packageLock.packages[''].version = version;
await fs.writeFile(lockPath, `${JSON.stringify(packageLock, null, 2)}\n`, 'utf8');

console.log(`Version metadata and npm lockfile synchronized from package.json: ${version}.`);
