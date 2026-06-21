#!/usr/bin/env node
// Runs the API server (mock provider, real-time timeline driver) + the Vite dev server.
import { spawn } from 'node:child_process';

const API_PORT = process.env.PORT ?? '8080';
const WEB_PORT = '5173';

const procs = [];
function run(name, cmd, args, env) {
  const p = spawn(cmd, args, {
    stdio: 'inherit',
    env: { ...process.env, ...env },
    shell: false,
  });
  p.on('exit', (code) => {
    console.log(`[dev] ${name} exited with ${code}`);
    shutdown(code ?? 0);
  });
  procs.push(p);
  return p;
}

function shutdown(code) {
  for (const p of procs) {
    if (!p.killed) p.kill('SIGINT');
  }
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

run('server', 'npx', ['tsx', 'packages/server/src/index.ts'], {
  PORT: API_PORT,
  HEXWALL_PROVIDER: process.env.HEXWALL_PROVIDER ?? 'mock',
  HEXWALL_DEV_TIMELINE: '1',
});

run('web', 'npx', ['vite', 'packages/web', '--port', WEB_PORT, '--strictPort'], {
  HEXWALL_API_TARGET: `http://127.0.0.1:${API_PORT}`,
});

setTimeout(() => {
  console.log('\n  Hexwall dev server');
  console.log(`  →  Web UI:  http://localhost:${WEB_PORT}`);
  console.log(`  →  API:     http://localhost:${API_PORT}/api/snapshot\n`);
}, 1500);
