import fs from 'fs';

const REQUIRED_HEADINGS = ['Summary', '摘要', 'References'];

const PAIRED_HEADINGS = [
  ['Features', '功能'],
  ['Fixes', '修复'],
  ['Breaking Changes', '破坏性变更'],
];

const OPTIONAL_UNPAIRED_HEADINGS = ['New Contributors'];

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
const emptyRequired = REQUIRED_HEADINGS.filter((heading) => {
  const value = sections.get(normalizeHeading(heading));
  return value !== undefined && value.trim() === '';
});

const emptyOptional = [];
const asymmetries = [];
for (const [en, zh] of PAIRED_HEADINGS) {
  const enValue = sections.get(normalizeHeading(en));
  const zhValue = sections.get(normalizeHeading(zh));
  if (enValue !== undefined && enValue.trim() === '') emptyOptional.push(en);
  if (zhValue !== undefined && zhValue.trim() === '') emptyOptional.push(zh);
  if ((enValue !== undefined) !== (zhValue !== undefined)) {
    asymmetries.push(`${en} / ${zh}`);
  }
}

for (const heading of OPTIONAL_UNPAIRED_HEADINGS) {
  const value = sections.get(normalizeHeading(heading));
  if (value !== undefined && value.trim() === '') emptyOptional.push(heading);
}

if (missing.length > 0 || emptyRequired.length > 0 || emptyOptional.length > 0 || asymmetries.length > 0) {
  if (missing.length > 0) {
    console.error(`Missing required release note sections: ${missing.join(', ')}`);
  }
  if (emptyRequired.length > 0) {
    console.error(`Empty required release note sections: ${emptyRequired.join(', ')}`);
  }
  if (emptyOptional.length > 0) {
    console.error(`Empty optional release note sections: ${emptyOptional.join(', ')} (omit the section instead of leaving it empty)`);
  }
  if (asymmetries.length > 0) {
    console.error(`Asymmetric bilingual sections (both English and Chinese must be present together): ${asymmetries.join(', ')}`);
  }
  console.error('Use .github/release-notes-template.md as the required structure.');
  process.exit(1);
}

console.log('Release notes structure is valid.');
