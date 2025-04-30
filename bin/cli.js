#!/usr/bin/env node

import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import fs from 'fs';

// Enable debug logging if needed
// process.env.DEBUG = 'true';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Start with more debug information
console.log('📋 MCPHub CLI');
console.log(`📁 CLI script location: ${__dirname}`);

// The npm package directory structure when installed is:
// node_modules/@samanhappy/mcphub/
//   - dist/
//   - bin/
//   - frontend/dist/

// Get the package root - this is where package.json is located
function findPackageRoot() {
  const isDebug = process.env.DEBUG === 'true';
  
  // Possible locations for package.json
  const possibleRoots = [
    // Standard npm package location
    path.resolve(__dirname, '..'),
    // When installed via npx
    path.resolve(__dirname, '..', '..', '..')
  ];
  
  // Special handling for npx
  if (process.argv[1] && process.argv[1].includes('_npx')) {
    const npxDir = path.dirname(process.argv[1]);
    possibleRoots.unshift(path.resolve(npxDir, '..'));
  }
  
  if (isDebug) {
    console.log('DEBUG: Checking for package.json in:', possibleRoots);
  }
  
  for (const root of possibleRoots) {
    const packageJsonPath = path.join(root, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        if (pkg.name === 'mcphub' || pkg.name === '@samanhappy/mcphub') {
          if (isDebug) {
            console.log(`DEBUG: Found package.json at ${packageJsonPath}`);
          }
          return root;
        }
      } catch (e) {
        // Continue to the next potential root
      }
    }
  }
  
  console.log('⚠️ Could not find package.json, using default path');
  return path.resolve(__dirname, '..');
}

// Locate and check the frontend distribution
function checkFrontend(packageRoot) {
  const isDebug = process.env.DEBUG === 'true';
  const frontendDistPath = path.join(packageRoot, 'frontend', 'dist');
  
  if (isDebug) {
    console.log(`DEBUG: Checking frontend at: ${frontendDistPath}`);
  }
  
  if (fs.existsSync(frontendDistPath) && fs.existsSync(path.join(frontendDistPath, 'index.html'))) {
    console.log('✅ Frontend distribution found');
    return true;
  } else {
    console.log('⚠️ Frontend distribution not found at', frontendDistPath);
    return false;
  }
}

const projectRoot = findPackageRoot();
console.log(`📦 Using package root: ${projectRoot}`);

// Check if frontend exists
checkFrontend(projectRoot);

// Start the server
console.log('🚀 Starting MCPHub server...');
import(path.join(projectRoot, 'dist', 'index.js')).catch(err => {
  console.error('Failed to start MCPHub:', err);
  process.exit(1);
});