// scripts/validate-docs.js
//
// Compiles every Mintlify MDX page under docs/ so that syntax errors fail in CI
// instead of at deploy time. Mintlify re-parses only the paths a commit touches
// and reports a broken page as "Deployment Failed" after the push; this runs the
// same @mdx-js/mdx compiler over the whole tree up front, and reports the same
// file:line:column location.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '@mdx-js/mdx';
import remarkFrontmatter from 'remark-frontmatter';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const docsRoot = path.join(projectRoot, 'docs');

const relative = (file) => path.relative(projectRoot, file).split(path.sep).join('/');

function collectMdxFiles(dir) {
  const files = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectMdxFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.mdx')) files.push(full);
  }

  return files;
}

async function main() {
  // Explicit paths let you validate a single page while editing it.
  const targets = process.argv.slice(2);
  const files =
    targets.length > 0
      ? targets.map((target) => path.resolve(target))
      : collectMdxFiles(docsRoot).sort();

  if (files.length === 0) {
    console.error(`❌ Error: no .mdx files found under ${relative(docsRoot)}.`);
    process.exit(1);
  }

  const failures = [];

  for (const file of files) {
    try {
      await compile(fs.readFileSync(file, 'utf8'), { remarkPlugins: [remarkFrontmatter] });
    } catch (error) {
      const reason = String(error.reason ?? error.message).split('\n')[0];
      const at = error.line ? `:${error.line}:${error.column}` : '';
      failures.push({ location: `${relative(file)}${at}`, reason });
    }
  }

  if (failures.length > 0) {
    console.error(`❌ ${failures.length} MDX page(s) failed to compile:\n`);

    for (const failure of failures) {
      console.error(`  ${failure.location}`);
      console.error(`    ${failure.reason}\n`);
    }

    console.error('Mintlify refuses to deploy the docs while a page cannot be compiled,');
    console.error('so fix the errors above before pushing changes under docs/.');
    process.exit(1);
  }

  console.log(`✅ Validated ${files.length} MDX page(s) under ${relative(docsRoot)}.`);
}

main().catch((error) => {
  console.error(`❌ ${error.message}`);
  process.exit(1);
});
