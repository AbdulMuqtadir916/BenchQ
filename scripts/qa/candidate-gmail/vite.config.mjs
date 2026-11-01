import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
const harness = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.BENCHQ_SOURCE || path.resolve(harness, '../../..');
const require = createRequire(path.join(root, 'package.json'));
const config = {
  root: harness,
  cacheDir: path.join(os.tmpdir(), 'benchq-gmail-qa-vite-cache'),
  resolve: { alias: [
    { find: 'next/navigation', replacement: path.join(harness, 'next-navigation.ts') },
    { find: 'next/link', replacement: path.join(harness, 'next-link.tsx') },
    { find: '@', replacement: path.join(root, 'src') },
    ...['react/jsx-dev-runtime', 'react/jsx-runtime', 'react-dom/client', 'react-dom', 'react', '@tanstack/react-query', 'zod'].map(name => ({ find: name, replacement: require.resolve(name) })),
  ] },
  define: { 'process.env.NEXT_PUBLIC_LIVE_MODULES': JSON.stringify('inbox'), 'process.env.NODE_ENV': JSON.stringify('development') },
  esbuild: { jsx: 'automatic', tsconfigRaw: { compilerOptions: { jsx: 'react-jsx' } } },
  css: { postcss: root },
  server: { host: process.env.QA_HOST || '127.0.0.1', port: Number(process.env.QA_PORT || 4185), strictPort: true, allowedHosts: ['host.docker.internal'], fs: { allow: [root, harness] } },
};

export default config;
