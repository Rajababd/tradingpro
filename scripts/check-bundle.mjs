// Runs after every production build: fails if development-only code leaked into the shipped bundle.
import { readdirSync, readFileSync } from 'node:fs';

const FORBIDDEN = ['__tradingpro']; // the browser-check test seam (src/app/devHook.ts)
const dir = new URL('../dist/assets/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
if (files.length === 0) {
  console.error('check-bundle: no JavaScript found in dist/assets: did the build run?');
  process.exit(1);
}
let bad = 0;
for (const file of files) {
  const text = readFileSync(new URL(file, dir), 'utf8');
  for (const needle of FORBIDDEN) {
    if (text.includes(needle)) {
      console.error(`check-bundle: "${needle}" found in dist/assets/${file}`);
      bad += 1;
    }
  }
}
if (bad > 0) process.exit(1);
console.log(`check-bundle: ok (${files.length} file${files.length === 1 ? '' : 's'}, no development-only code)`);
