import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { securityHeaders } from './worker/security.ts';

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    cors: false,
    headers: {
      ...securityHeaders,
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:5173 ws://localhost:5173; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    },
    fs: {
      strict: true,
      allow: ['.'],
      deny: [
        '**/.local-auth/**',
        '**/.venv/**',
        '**/logs/**',
        '**/upstream-trial/**',
        '**/.git/**',
        '**/backend/**',
        '**/tests/**',
        '**/*.py',
        '**/.env*',
        '**/.dev.vars*',
        '**/*.{pem,crt}',
      ],
    },
    proxy: { '/api': { target: 'http://127.0.0.1:8788', changeOrigin: true } },
  },
  preview: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    cors: false,
    headers: securityHeaders,
    proxy: { '/api': { target: 'http://127.0.0.1:8788', changeOrigin: true } },
  },
  build: { outDir: 'dist', sourcemap: false },
});
