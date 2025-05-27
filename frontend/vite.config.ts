import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import tailwindcss from '@tailwindcss/vite';
// Import the package.json to get the version
import { readFileSync } from 'fs';

// Get package.json version
const packageJson = JSON.parse(readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'));

// Get base path from environment variable
const basePath = process.env.BASE_PATH || '';

// https://vitejs.dev/config/
export default defineConfig({
  base: basePath || './', // Use base path or relative paths for assets
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: {
    // Make package version and base path available as global variables
    'import.meta.env.PACKAGE_VERSION': JSON.stringify(packageJson.version),
    'import.meta.env.BASE_PATH': JSON.stringify(basePath),
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
    },
  },
});
