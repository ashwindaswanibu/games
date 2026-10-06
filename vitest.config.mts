import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` throws outside a React Server environment. Tests run server modules
      // directly (with fakes for anything that does IO), so resolve it to its no-op build.
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
  // Content-pipeline helpers (scripts/content/**) are tested too; their imports use .mjs specifiers.
  test: { include: ["src/**/*.test.ts", "scripts/**/*.test.mts"], environment: "node" },
});
