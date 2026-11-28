import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function readGit(cmd: string, fallback: string): string {
  try {
    const value = execSync(cmd, { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    return value || fallback;
  } catch {
    return fallback;
  }
}

const appVersion: string =
  JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8')).version ?? '0.0.0';
const gitSha = readGit('git rev-parse --short HEAD', 'dev');
const branchRaw = readGit('git rev-parse --abbrev-ref HEAD', 'main');
const gitBranch = branchRaw === 'HEAD' ? 'main' : branchRaw;
const gitTag = readGit('git describe --tags --exact-match', '');
const builtAt = new Date().toISOString();

const versionInfo = {
  version: appVersion,
  gitSha,
  gitTag,
  branch: gitBranch,
  builtAt,
};
const versionJson = `${JSON.stringify(versionInfo, null, 2)}\n`;

function emitVersionJson(): Plugin {
  return {
    name: 'emit-version-json',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== '/version.json') {
          next();
          return;
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.end(versionJson);
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: versionJson });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), emitVersionJson()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __GIT_SHA__: JSON.stringify(gitSha),
    __BUILT_AT__: JSON.stringify(builtAt),
  },
  resolve: {
    alias: {
      '@webpob/core': path.resolve(__dirname, '../../packages/core/src/index.ts'),
      '@webpob/i18n': path.resolve(__dirname, '../../packages/i18n/src/index.ts'),
      '@webpob/data': path.resolve(__dirname, '../../packages/data/src/index.ts'),
      '@webpob/codec': path.resolve(__dirname, '../../packages/codec/src/index.ts'),
      '@webpob/calc/lite': path.resolve(__dirname, '../../packages/calc/src/lite.ts'),
      '@webpob/calc': path.resolve(__dirname, '../../packages/calc/src/index.ts'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'react-vendor';
          }
          if (id.includes('node_modules/lucide-react')) {
            return 'lucide-icons';
          }
          if (id.includes('node_modules/pako') || id.includes('node_modules/zustand')) {
            return 'utils-vendor';
          }
          if (
            id.includes('/packages/calc/src/lite.ts') ||
            id.includes('/packages/calc/src/diagnostics.ts') ||
            id.includes('/packages/calc/src/localItem.ts') ||
            id.includes('/packages/calc/src/offenceUpgrade.ts')
          ) {
            return 'webpob-calc-lite';
          }
          if (id.includes('/packages/calc/')) {
            return 'webpob-calc';
          }
          if (id.includes('/packages/data/') || id.includes('/packages/i18n/')) {
            return 'webpob-data';
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
  },
});
