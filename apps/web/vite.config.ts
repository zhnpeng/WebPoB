import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { onRequest as proxyOnRequest } from './functions/api/proxy';

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

function attachLocalEdgeRoutes(middlewares: {
  use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void;
}) {
  middlewares.use((req, res, next) => {
    const rawUrl = req.url ?? '/';
    const pathname = rawUrl.split('?')[0];
    if (pathname === '/version.json') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.end(versionJson);
      return;
    }
    if (pathname !== '/api/proxy') {
      next();
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      void (async () => {
        try {
          const host = req.headers.host ?? '127.0.0.1:4173';
          const method = req.method ?? 'GET';
          const bodyBuf = Buffer.concat(chunks);
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(req.headers)) {
            if (typeof v === 'string') headers[k] = v;
            else if (Array.isArray(v)) headers[k] = v.join(', ');
          }
          const webReq = new Request(`http://${host}${rawUrl}`, {
            method,
            headers,
            body:
              method === 'GET' || method === 'HEAD' || method === 'OPTIONS'
                ? undefined
                : bodyBuf,
          });
          const webRes = await proxyOnRequest({ request: webReq });
          res.statusCode = webRes.status;
          webRes.headers.forEach((value, key) => {
            const lower = key.toLowerCase();
            if (lower === 'content-encoding' || lower === 'content-length') return;
            res.setHeader(key, value);
          });
          res.end(Buffer.from(await webRes.arrayBuffer()));
        } catch (err) {
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      })();
    });
  });
}

function emitVersionJson(): Plugin {
  return {
    name: 'emit-version-json',
    configureServer(server) {
      attachLocalEdgeRoutes(server.middlewares);
    },
    configurePreviewServer(server) {
      attachLocalEdgeRoutes(server.middlewares);
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
    alias: [
      {
        find: '@webpob/calc/diagnostics',
        replacement: path.resolve(__dirname, '../../packages/calc/src/diagnostics.ts'),
      },
      {
        find: '@webpob/calc/localItem',
        replacement: path.resolve(__dirname, '../../packages/calc/src/localItem.ts'),
      },
      {
        find: '@webpob/core',
        replacement: path.resolve(__dirname, '../../packages/core/src/index.ts'),
      },
      {
        find: '@webpob/i18n',
        replacement: path.resolve(__dirname, '../../packages/i18n/src/index.ts'),
      },
      {
        find: '@webpob/data',
        replacement: path.resolve(__dirname, '../../packages/data/src/index.ts'),
      },
      {
        find: '@webpob/codec',
        replacement: path.resolve(__dirname, '../../packages/codec/src/index.ts'),
      },
      {
        find: '@webpob/calc',
        replacement: path.resolve(__dirname, '../../packages/calc/src/index.ts'),
      },
    ],
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
