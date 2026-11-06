import { defineConfig } from "vitest/config";

// The tests never load a stylesheet. An empty PostCSS setup stops Vite from loading postcss.config.mjs, which is for the Next.js build.
export default defineConfig({ css: { postcss: { plugins: [] } } });
