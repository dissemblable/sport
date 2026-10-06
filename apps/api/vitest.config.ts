import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Les tests d'intégration partagent une base : les exécuter en parallèle
    // ferait diverger l'état de fatigue d'un fichier à l'autre.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
