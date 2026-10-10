import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(fileURLToPath(new URL(".", import.meta.url)), "src"),
    },
  },
  test: {
    globals: true,
  },
});
