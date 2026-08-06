import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const webRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  base: process.env.GITHUB_PAGES_BASE ?? "/warhammercalculator/",
  root: path.join(webRoot, "static-site"),
  publicDir: path.join(webRoot, "public"),
  plugins: [react()],
  build: {
    outDir: path.join(webRoot, "dist-pages"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.join(webRoot, "static-site/index.html"),
        "unit-vs-unit": path.join(webRoot, "static-site/unit-vs-unit/index.html"),
        lists: path.join(webRoot, "static-site/lists/index.html"),
        play: path.join(webRoot, "static-site/play/index.html"),
        agent: path.join(webRoot, "static-site/agent/index.html"),
      },
    },
  },
});
