// Creates nirbhay-pen-battle-source.zip without node_modules, build output or secrets.
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';

const out = 'nirbhay-pen-battle-source.zip';
rmSync(out, { force: true });
execFileSync('zip', ['-r', '-q', out, '.', '-x',
  'node_modules/*', '.next/*', 'dist/*', '.git/*', 'test-results/*', '.vercel/*',
  '.env', '.env.*.local', '.env.local', '*.zip', '*.tsbuildinfo', 'next-env.d.ts', '.DS_Store', '*/.DS_Store',
], { stdio: 'inherit' });
console.log(`Wrote ${out}`);
