/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import tsConfigPaths from 'vite-tsconfig-paths'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'
import viteReact from '@vitejs/plugin-react'

// nitro is build-only: with nitro@3 beta + vite 8, the nitro() dev worker
// fails on warm restarts ('Vite environment "ssr" is unavailable'), and
// tanstackStart() serves dev SSR by itself. nitro still bundles the
// production server to .output/server/index.mjs for `npm start`.
export default defineConfig(({ command }) => ({
  server: { port: 3000 },
  plugins: [
    tsConfigPaths(),
    tanstackStart(),
    ...(command === 'build' ? [nitro()] : []),
    viteReact(),
  ],
  test: {
    // *.int.test.ts files share one Postgres instance + the 'admin-test'
    // local admin row (bootstrap.int.test.ts, sessions.int.test.ts); vitest's
    // default cross-file parallelism races those tests against each other.
    fileParallelism: false,
  },
}))
