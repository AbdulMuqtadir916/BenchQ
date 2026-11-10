/// <reference types="node" />
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { buildManifest } from "./manifest.ts";

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

/** dist/manifest.json, written for this build's BenchQ address. A store build (BENCHQ_STORE=1) must be https and name
 * its sites; anything else is a local build, which may point at localhost. */
function manifest(benchqUrl: string, isStore: boolean): Plugin {
  return {
    name: "benchq-manifest",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "manifest.json", source: `${JSON.stringify(buildManifest({ benchqUrl, isStore }), null, 2)}
` });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const benchqUrl = env.BENCHQ_URL || "http://localhost:3000";
  const isStore = (process.env.BENCHQ_STORE ?? env.BENCHQ_STORE) === "1";
  if (isStore && !benchqUrl.startsWith("https://")) throw new Error("A store build needs BENCHQ_URL to be the https address of BenchQ.");
  return {
    plugins: [react(), pageScript(), manifest(benchqUrl, isStore)],
    define: {
      __BENCHQ_URL__: JSON.stringify(benchqUrl),
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
