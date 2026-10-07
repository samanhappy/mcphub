import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

// The published package must carry the patched client: consumers installing
// with npm do not apply our pnpm.patchedDependencies configuration.
await build({
  entryPoints: ['src/clients/mcpSdkClient.ts'],
  outfile: 'dist/clients/mcpSdkClient.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: true,
  banner: {
    js: `import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);\n/*\n${readFileSync('node_modules/@modelcontextprotocol/client/LICENSE', 'utf8')}\n*/`,
  },
});
