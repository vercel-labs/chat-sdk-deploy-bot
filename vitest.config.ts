import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "."),
    },
  },
  test: {
    coverage: {
      exclude: ["lib/**/*.test.ts"],
      include: ["lib/**/*.ts", "lib/**/*.tsx"],
      provider: "v8",
    },
    include: ["**/*.test.ts"],
  },
});
