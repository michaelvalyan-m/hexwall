import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/{shared,server}/src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['packages/shared/src/**/*.ts', 'packages/server/src/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/_testutil.ts',
        'packages/shared/src/index.ts',
        'packages/server/src/index.ts',
        'packages/server/src/providers/kubeProvider.ts',
      ],
      thresholds: {
        // packages/shared core is held to a higher bar in its own statements below.
        lines: 75,
        functions: 75,
        branches: 75,
        statements: 75,
        'packages/shared/src/rollup.ts': { lines: 90, branches: 90, functions: 90, statements: 90 },
        'packages/shared/src/nodeHealth.ts': { lines: 90, branches: 90, functions: 90, statements: 90 },
        'packages/shared/src/podState.ts': { lines: 90, branches: 90, functions: 90, statements: 90 },
        'packages/shared/src/logTokens.ts': { lines: 90, branches: 90, functions: 90, statements: 90 },
        'packages/shared/src/engine.ts': { lines: 90, branches: 90, functions: 90, statements: 90 },
        'packages/shared/src/crash.ts': { lines: 90, branches: 90, functions: 90, statements: 90 },
      },
    },
  },
});
