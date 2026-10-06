import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // Le fichier .env vit à la racine du monorepo, partagé avec l'API.
  const rootDir = fileURLToPath(new URL('../..', import.meta.url));
  const env = loadEnv(mode, rootDir, '');

  return {
    plugins: [react(), tailwindcss()],
    envDir: rootDir,
    server: {
      port: 5173,
      // Le frontend appelle l'API en relatif via /api : le proxy évite toute
      // configuration CORS côté navigateur en développement.
      proxy: {
        '/api': {
          target: env.VITE_API_URL || 'http://127.0.0.1:3000',
          changeOrigin: true,
        },
      },
    },
    build: { outDir: 'dist', sourcemap: true },
  };
});
