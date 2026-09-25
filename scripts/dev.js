// Sobe a API local e o Vite juntos: npm run dev
import { spawn } from 'node:child_process';

const procs = [
  spawn(process.execPath, ['scripts/dev-api.js'], { stdio: 'inherit' }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' }),
];
const stop = () => procs.forEach((p) => p.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
procs.forEach((p) => p.on('exit', stop));
