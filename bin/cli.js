#!/usr/bin/env node

import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Subcommands routed to the CLI dispatcher in dist/cli/main.js. Anything else
// (including no args) falls through to the legacy server bootstrap so
// `npx @samanhappy/mcphub` keeps working exactly as before.
const CLI_COMMANDS = new Set([
  'login',
  'logout',
  'config',
  'servers',
  'groups',
  'keys',
  'tools',
  'call',
  'export',
  'discover',
  'install',
  'help',
  '--help',
  '-h',
  '--version',
  '-v',
]);

const argv = process.argv.slice(2);
const isCliCommand = argv.length > 0 && CLI_COMMANDS.has(argv[0]);

function findPackageRoot() {
  const isDebug = process.env.DEBUG === 'true';

  const possibleRoots = [
    path.resolve(__dirname, '..'),
    path.resolve(__dirname, '..', '..', '..'),
  ];

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

  if (!isCliCommand) {
    console.log('⚠️ Could not find package.json, using default path');
  }
  return path.resolve(__dirname, '..');
}

const projectRoot = findPackageRoot();

if (isCliCommand) {
  // CLI subcommand path — keep stdout clean for --json / pipes.
  const cliEntryPath = path.join(projectRoot, 'dist', 'cli', 'main.js');
  if (!fs.existsSync(cliEntryPath)) {
    console.error('❌ CLI build missing: ' + cliEntryPath);
    console.error('Run "pnpm backend:build" (or "pnpm build") and retry.');
    process.exit(1);
  }
  const cliEntryUrl = pathToFileURL(cliEntryPath).href;
  const mod = await import(cliEntryUrl);
  await mod.runCli(argv);
} else {
  // Legacy: server bootstrap. Existing console.log banner preserved here so it
  // never leaks into CLI subcommand output.
  console.log('📋 MCPHub CLI');
  console.log(`📁 CLI script location: ${__dirname}`);
  console.log(`📦 Using package root: ${projectRoot}`);

  const frontendDistPath = path.join(projectRoot, 'frontend', 'dist');
  if (
    fs.existsSync(frontendDistPath) &&
    fs.existsSync(path.join(frontendDistPath, 'index.html'))
  ) {
    console.log('✅ Frontend distribution found');
  } else {
    console.log('⚠️ Frontend distribution not found at', frontendDistPath);
  }

  console.log('🚀 Starting MCPHub server...');
  const entryPath = path.join(projectRoot, 'dist', 'index.js');
  const entryUrl = pathToFileURL(entryPath).href;
  import(entryUrl).catch((err) => {
    console.error('Failed to start MCPHub:', err);
    process.exit(1);
  });
}
