/// <reference types="node" />
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/** page.js is injected as a classic script, again on every scan. So it can't import anything, and its top-level
 * names go inside a function, where a second injection can't collide with them. */
function pageScript(): Plugin {
  return {
    name: "benchq-page-script",
    generateBundle(_options, bundle) {
      const chunk = bundle["page.js"];
      if (chunk?.type !== "chunk") return;
      if (chunk.imports.length > 0) this.error("src/page must not share runtime code: page.js has to stand alone.");
      chunk.code = `(() => {\n${chunk.code}\n})();\n`;
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), pageScript()],
    define: {
      __BENCHQ_URL__: JSON.stringify(env.BENCHQ_URL || "http://localhost:3000"),
      __PAGE_BUILD__: JSON.stringify(Date.now().toString(36)),
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      rollupOptions: {
        input: { panel: "index.html", background: "src/background.ts", page: "src/page/index.ts" },
        output: { entryFileNames: "[name].js", chunkFileNames: "assets/[name]-[hash].js", assetFileNames: "assets/[name]-[hash][extname]" },
      },
    },
  };
});
