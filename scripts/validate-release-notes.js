import fs from 'fs';

const REQUIRED_HEADINGS = [
  'Summary',
  'Highlights',
  'Fixes',
  'Breaking Changes',
  'Upgrade Notes',
  '中文摘要',
  '中文亮点',
  '中文修复',
  '破坏性变更',
  '升级说明',
];

function usage() {
  console.error('Usage: node scripts/validate-release-notes.js <file>');
  console.error('   or: node scripts/validate-release-notes.js --env RELEASE_BODY');
}

function readInput() {
  const [mode, value] = process.argv.slice(2);
  if (!mode) {
    usage();
    process.exit(2);
  }

  if (mode === '--env') {
    if (!value || !process.env[value]) {
      console.error(`Missing environment variable: ${value || '(not provided)'}`);
      process.exit(2);
    }
    return process.env[value];
  }

  if (!fs.existsSync(mode)) {
    console.error(`Release notes file not found: ${mode}`);
    process.exit(2);
  }
  return fs.readFileSync(mode, 'utf8');
}

function normalizeHeading(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[:：]+$/g, '')
    .replace(/\s+/g, ' ');
}

function collectSections(markdown) {
  const sections = new Map();
  const lines = markdown.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  let current = null;
  let currentLines = [];

  function flush() {
    if (!current) return;
    sections.set(normalizeHeading(current), currentLines.join('\n').trim());
  }

  for (const line of lines) {
    const heading = line.match(/^#{2,3}\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flush();
      current = heading[1];
      currentLines = [];
      continue;
    }
    if (current) currentLines.push(line);
  }
  flush();

  return sections;
}

const markdown = readInput();
const sections = collectSections(markdown);
const missing = REQUIRED_HEADINGS.filter((heading) => !sections.has(normalizeHeading(heading)));
const empty = REQUIRED_HEADINGS.filter((heading) => {
  const value = sections.get(normalizeHeading(heading));
  return value !== undefined && value.trim() === '';
});

if (missing.length > 0 || empty.length > 0) {
  if (missing.length > 0) {
    console.error(`Missing release note sections: ${missing.join(', ')}`);
  }
  if (empty.length > 0) {
    console.error(`Empty release note sections: ${empty.join(', ')}`);
  }
  console.error('Use .github/release-notes-template.md as the required structure.');
  process.exit(1);
}

console.log('Release notes structure is valid.');

