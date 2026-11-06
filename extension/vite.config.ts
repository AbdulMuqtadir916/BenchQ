import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react()],
    define: { __BENCHQ_URL__: JSON.stringify(env.BENCHQ_URL || "http://localhost:3000") },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      rollupOptions: {
        input: { panel: "index.html", background: "src/background.ts" },
        output: { entryFileNames: "[name].js", chunkFileNames: "assets/[name]-[hash].js", assetFileNames: "assets/[name]-[hash][extname]" },
      },
    },
  };
});
