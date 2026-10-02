import path from "node:path";
import { defineConfig } from "vitest/config";

// `npm test` prueba contra SQLite; `npm run test:pg` (modo "pg") contra PostgreSQL embebido con el esquema real.
export default defineConfig(({ mode }) => ({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 120_000,
    env: mode === "pg" ? { TEST_STORE: "pg" } : {},
  },
}));
