import { cpSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
cpSync('src', 'dist/src', { recursive: true });
cpSync('public', 'dist/public', { recursive: true });
copyFileSync('package.json', 'dist/package.json');
copyFileSync('.env.example', 'dist/.env.example');
console.log('Build created in dist/');
