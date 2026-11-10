import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The tests never load a stylesheet. An empty PostCSS setup stops Vite from loading postcss.config.mjs, which is for the Next.js build.
// JSX is compiled the React 17+ way and "@/" points at src/, as in the app, so tests can render components on the server.
export default defineConfig({
  css: { postcss: { plugins: [] } },
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
