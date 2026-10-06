import { defineConfig } from 'tsup';

/**
 * Bundle de production de l'API.
 *
 * Tout est embarqué dans `dist/index.js` — paquets du monorepo comme
 * dépendances npm. Les paquets internes exposent leurs sources TypeScript, que
 * Node n'exécute pas seul ; un bundle complet évite en plus de copier
 * `node_modules` dans l'image Docker, qui ne contient que Node et ce fichier.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node22',
  clean: true,
  sourcemap: true,
  noExternal: [/.*/],
  // `pg` et `dotenv` sont en CommonJS et appellent `require`, absent en ESM.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
