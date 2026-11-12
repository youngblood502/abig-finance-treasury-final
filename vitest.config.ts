import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The tests never load a stylesheet. An empty PostCSS setup stops Vite from loading postcss.config.mjs, which is for the Next.js build.
// JSX is compiled the React 17+ way and "@/" points at src/, as in the app, so tests can render components on the server.
// The database tests run only on the isolated test server (npm run testdb:start): tests/global-setup.ts reads .env.test, removes every other database
// variable, and checks the server before anything runs; tests/setup-env.ts re-checks the environment in each worker. See docs/TEST-GUIDE.md.
// Test files run one at a time: every database test creates its scratch database on the test server and sets the passwords of its server-wide roles
// (ALTER ROLE abig_app / abig_worker / abig_auth), and concurrent ALTER ROLE statements fail with "tuple concurrently updated".
// beforeAll builds a fresh scratch database and applies every migration, about 10s, so hooks get a minute rather than the 10s default.
export default defineConfig({
  test: { globalSetup: ["tests/global-setup.ts"], setupFiles: ["tests/setup-env.ts"], fileParallelism: false, hookTimeout: 60_000 },
  css: { postcss: { plugins: [] } },
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
