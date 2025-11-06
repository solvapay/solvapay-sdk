import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000, // MCP operations can take time
    hookTimeout: 30000,
    teardownTimeout: 30000,
  },
});
