// Copies dist/ to ../site/app/ (the VPS serves site/ from a git pull; SPEC.md §9).
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const target = resolve(root, '..', 'site', 'app');
if (!existsSync(dist)) throw new Error('dist/ missing: run vite build first');
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(dist, target, { recursive: true });
process.stdout.write(`copied ${dist} -> ${target}\n`);
