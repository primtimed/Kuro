import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Each test file gets a throwaway in-memory database
    env: { DB_PATH: ":memory:", GOOGLE_CLIENT_ID: "test-client-id" },
  },
});
