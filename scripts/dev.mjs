import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const production = process.argv.includes('--production');
const children = [
  spawn(root + '.venv/bin/python', ['-u', 'backend/web_api.py'], { cwd: root, stdio: 'inherit' }),
  spawn(
    process.execPath,
    [
      'node_modules/vite/bin/vite.js',
      ...(production ? ['preview'] : []),
      '--host',
      '127.0.0.1',
      '--port',
      '5173',
      '--strictPort',
    ],
    { cwd: root, stdio: 'inherit' },
  ),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}
for (const child of children) {
  child.on('error', (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on('exit', (code) => stop(code || 0));
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
console.log(
  'iGPSPORT Hub: http://127.0.0.1:5173 • Keep this terminal open. Ctrl+C stops both services.',
);
