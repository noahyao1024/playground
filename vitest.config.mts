import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // The alias tsconfig declares, so a test imports exactly what the app does.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // The SQL suite waits on a deliberate pause inside a database function.
    testTimeout: 20_000,
  },
});
