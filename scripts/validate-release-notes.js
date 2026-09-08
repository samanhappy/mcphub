import fs from 'fs';

const REQUIRED_HEADINGS = ['Summary', '摘要', 'References'];

const PAIRED_HEADINGS = [
  ['Features', '功能'],
  ['Fixes', '修复'],
];

const OPTIONAL_UNPAIRED_HEADINGS = ['New Contributors'];

// Canonical section order, matching .github/release-notes-template.md.
const SECTION_ORDER = [
  'Summary',
  'Features',
  'Fixes',
  '摘要',
  '功能',
  '修复',
  'New Contributors',
  'References',
];

const REFERENCE_BULLET_RE =
  /^-\s+.*? by @\S+ in https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/(?:pull|issues)\/\d+\s*$/;
const FULL_CHANGELOG_RE = /^-\s*Full changelog:\s+https?:\/\/github\.com\/[^\s]+\/compare\/[^\s]+\.\.\.[^\s]+\s*$/;
const NEW_CONTRIBUTOR_RE = /^-\s*@\S+ made their first contribution in #\d+\s*$/;
// The skill forbids placeholder content: HTML comments, fill-in markers from
// scripts/build-release-notes.js, and "None"/"无" stubs.
const PLACEHOLDER_RE = /<!--|<<FILL|^\s*(?:-?\s*)?(?:None|无)\s*$/;

function usage() {
  console.error('Usage: node scripts/validate-release-notes.js <file>');
  console.error('   or: node scripts/validate-release-notes.js --stdin');
  console.error('   or: node scripts/validate-release-notes.js --env RELEASE_BODY');
}

function readInput() {
  const [mode, value] = process.argv.slice(2);
  if (!mode) {
    usage();
    process.exit(2);
  }

  if (mode === '--stdin') {
    return fs.readFileSync(0, 'utf8');
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

function checkOrder(sections) {
  const canonical = SECTION_ORDER.map(normalizeHeading);
  const seen = [...sections.keys()];
  const problems = [];
  const indexes = seen.map((heading) => canonical.indexOf(heading));
  for (let i = 0; i < seen.length; i++) {
    if (indexes[i] === -1) {
      problems.push(
        `Unexpected section "${seen[i]}" (allowed sections, in order: ${SECTION_ORDER.join(', ')})`,
      );
      continue;
    }
    if (i > 0 && indexes[i] < indexes[i - 1]) {
      problems.push(`Sections out of order: "${seen[i]}" must come after "${seen[i - 1]}"`);
    }
  }
  return problems;
}

function checkReferences(value) {
  const problems = [];
  const lines = value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const changelogLines = lines.filter((line) => FULL_CHANGELOG_RE.test(line));
  if (changelogLines.length !== 1) {
    problems.push(
      `References must contain exactly one "Full changelog:" line (found ${changelogLines.length})`,
    );
  }

  const bad = lines.filter((line) => !FULL_CHANGELOG_RE.test(line) && !REFERENCE_BULLET_RE.test(line));
  if (bad.length > 0) {
    problems.push(
      `References bullets must match "- <title> by @<login> in <pull url>" format:\n  ${bad.join('\n  ')}`,
    );
  }

  return problems;
}

function checkNewContributors(value) {
  const lines = value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const bad = lines.filter((line) => !NEW_CONTRIBUTOR_RE.test(line));
  if (bad.length > 0) {
    return [
      `New Contributors bullets must match "- @<login> made their first contribution in #<number>":\n  ${bad.join('\n  ')}`,
    ];
  }
  return [];
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

const placeholders = [];
for (const [heading, value] of sections) {
  const lines = value.split('\n').map((line) => line.trim()).filter(Boolean);
  const bad = lines.filter((line) => PLACEHOLDER_RE.test(line));
  if (bad.length > 0) {
    placeholders.push(`"${heading}" contains placeholder content (HTML comments, <<FILL markers, or None/无 stubs):\n  ${bad.join('\n  ')}`);
  }
}

const problems = [...checkOrder(sections)];
if (sections.has(normalizeHeading('References'))) {
  problems.push(...checkReferences(sections.get(normalizeHeading('References'))));
}
if (sections.has(normalizeHeading('New Contributors'))) {
  problems.push(...checkNewContributors(sections.get(normalizeHeading('New Contributors'))));
}
problems.push(...placeholders);

if (missing.length > 0 || emptyRequired.length > 0 || emptyOptional.length > 0 || asymmetries.length > 0 || problems.length > 0) {
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
  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(problem);
    }
  }
  console.error('Use .github/release-notes-template.md as the required structure.');
  process.exit(1);
}

console.log('Release notes structure is valid.');
