import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import tailwindcss from '@tailwindcss/vite';
// Import the package.json to get the version
import { readFileSync } from 'fs';

// Get package.json version
const packageJson = JSON.parse(readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'));

// For runtime configuration, we'll always use relative paths
// BASE_PATH will be determined at runtime
const basePath = '';

// https://vitejs.dev/config/
export default defineConfig({
  base: './', // Always use relative paths for runtime configuration
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: {
    // Make package version available as global variable
    // BASE_PATH will be loaded at runtime
    'import.meta.env.PACKAGE_VERSION': JSON.stringify(packageJson.version),
  },
  build: {
    sourcemap: true, // Enable source maps for production build
  },
  server: {
    proxy: {
      [`${basePath}/api`]: {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      [`${basePath}/auth`]: {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      [`${basePath}/config`]: {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      [`${basePath}/public-config`]: {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
