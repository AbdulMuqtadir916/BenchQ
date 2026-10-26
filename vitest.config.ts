import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // Claude Code worktrees (`.claude/worktrees/*`) hold whole copies of the repo: their tests are not this checkout's.
    exclude: [...configDefaults.exclude, ".claude/**"],
  },
});
