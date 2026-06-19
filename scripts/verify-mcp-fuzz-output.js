#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const outputDir = process.argv[2] || 'fuzz-output';
const minToolRuns = Number.parseInt(process.env.MCP_FUZZ_MIN_TOOL_RUNS || '1', 10);

const fail = (message) => {
  console.error(`mcp fuzz verification failed: ${message}`);
  process.exit(1);
};

const readJson = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail(`could not parse ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const requireFile = (fileName) => {
  const filePath = path.join(outputDir, fileName);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
    fail(`missing non-empty ${fileName}`);
  }
  return filePath;
};

const findingsPath = requireFile('findings.json');
const findings = readJson(findingsPath);
if (!Array.isArray(findings.findings)) {
  fail('findings.json does not contain a findings array');
}

const summaryPath = path.join(outputDir, 'run_summary.json');
if (fs.existsSync(summaryPath)) {
  const summary = readJson(summaryPath);
  if (summary.status !== 'completed') {
    fail(`run_summary.json status is ${JSON.stringify(summary.status)}`);
  }

  const toolCount = Number(summary.tools?.total || 0);
  const totalRuns = Number(summary.tools?.total_runs || 0);
  if (toolCount < 1) {
    fail('run_summary.json reports zero tools');
  }
  if (totalRuns < minToolRuns) {
    fail(`run_summary.json reports ${totalRuns} tool runs; expected at least ${minToolRuns}`);
  }

  console.log(`verified MCP fuzz summary: ${toolCount} tools, ${totalRuns} tool runs`);
  process.exit(0);
}

const logPath = requireFile('fuzzer.log');
const log = fs.readFileSync(logPath, 'utf8');
if (/Status:\s*BLOCKED/i.test(log)) {
  fail('fuzzer.log reports a blocked run');
}

const toolsMatch = log.match(/Status:\s*completed\s*[—-]\s*(\d+)\s+tool\(s\)\s+fuzzed/i);
const runsMatch = log.match(/Total Fuzzing Runs:\s*(\d+)/i);
if (!toolsMatch) {
  fail('fuzzer.log does not report completed tool fuzzing');
}

const toolCount = Number.parseInt(toolsMatch[1], 10);
const totalRuns = runsMatch ? Number.parseInt(runsMatch[1], 10) : 0;
if (toolCount < 1) {
  fail('fuzzer.log reports zero fuzzed tools');
}
if (totalRuns < minToolRuns) {
  fail(`fuzzer.log reports ${totalRuns} tool runs; expected at least ${minToolRuns}`);
}

console.log(`verified MCP fuzz log: ${toolCount} tools, ${totalRuns} tool runs`);
