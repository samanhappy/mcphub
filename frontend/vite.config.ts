import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import tailwindcss from '@tailwindcss/vite';
import { createDevBasePathRedirectPlugin } from './viteBasePath.js';
import { createDevProxyConfig } from './viteProxy.js';
// Import the package.json to get the version
import { readFileSync } from 'fs';

// Get package.json version
const packageJson = JSON.parse(readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'));

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, '..'), '');

  return {
    base: './',
    plugins: [createDevBasePathRedirectPlugin(env.BASE_PATH), react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    define: {
      'import.meta.env.PACKAGE_VERSION': JSON.stringify(packageJson.version),
    },
    build: {
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) {
              return undefined;
            }

            if (
              id.includes('/react/') ||
              id.includes('/react-dom/') ||
              id.includes('/scheduler/') ||
              id.includes('/react-router/') ||
              id.includes('/react-router-dom/') ||
              id.includes('/@remix-run/')
            ) {
              return 'framework-vendor';
            }

            if (
              id.includes('/i18next/') ||
              id.includes('/react-i18next/') ||
              id.includes('/i18next-browser-languagedetector/')
            ) {
              return 'i18n-vendor';
            }

            if (id.includes('/lucide-react/')) {
              return 'icons-vendor';
            }

            return undefined;
          },
        },
      },
    },
    server: {
      proxy: createDevProxyConfig(env.BASE_PATH),
    },
  };
});
