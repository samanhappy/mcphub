import { maybeCompressToolResult } from '../../src/services/toolResultCompressionService.js';
import { setCachedSystemConfig } from '../../src/utils/systemConfigCache.js';

const largeLines = (prefix: string, count: number): string =>
  Array.from({ length: count }, (_value, index) => `${prefix} line ${index} with repeated payload data`).join('\n');

describe('toolResultCompressionService', () => {
  afterEach(() => {
    setCachedSystemConfig(null);
  });

  it('returns the original result when compression is disabled', async () => {
    setCachedSystemConfig({
      toolResultCompression: {
        enabled: false,
        minTokens: 1,
        maxOutputTokens: 50,
        strategy: 'text',
      },
    });

    const result = { content: [{ type: 'text', text: largeLines('disabled', 200) }] };
    await expect(maybeCompressToolResult(result)).resolves.toBe(result);
  });

  it('returns the original result for error tool responses', async () => {
    setCachedSystemConfig({
      toolResultCompression: {
        enabled: true,
        minTokens: 1,
        maxOutputTokens: 50,
        strategy: 'text',
      },
    });

    const result = {
      isError: true,
      content: [{ type: 'text', text: largeLines('error', 200) }],
    };

    await expect(maybeCompressToolResult(result)).resolves.toBe(result);
  });

  it('leaves small text blocks unchanged below minTokens', async () => {
    setCachedSystemConfig({
      toolResultCompression: {
        enabled: true,
        minTokens: 10_000,
        maxOutputTokens: 50,
        strategy: 'text',
      },
    });

    const result = { content: [{ type: 'text', text: 'small output' }] };
    await expect(maybeCompressToolResult(result)).resolves.toBe(result);
  });

  it('compresses large text blocks with a marker', async () => {
    setCachedSystemConfig({
      toolResultCompression: {
        enabled: true,
        minTokens: 1,
        maxOutputTokens: 80,
        strategy: 'text',
      },
    });

    const originalText = largeLines('text', 300);
    const result = await maybeCompressToolResult({
      content: [{ type: 'text', text: originalText }],
    });

    expect(result.content?.[0].text).toContain('[mcphub:compressed-tool-result');
    expect(result.content?.[0].text).toContain('strategy=text');
    expect(result.content?.[0].text).not.toBe(originalText);
  });

  it('preserves non-text content blocks', async () => {
    setCachedSystemConfig({
      toolResultCompression: {
        enabled: true,
        minTokens: 1,
        maxOutputTokens: 80,
        strategy: 'text',
      },
    });

    const imageBlock = { type: 'image', data: 'abc123', mimeType: 'image/png' };
    const result = await maybeCompressToolResult({
      content: [
        { type: 'text', text: largeLines('mixed', 250) },
        imageBlock,
      ],
    });

    expect(result.content?.[0].text).toContain('strategy=text');
    expect(result.content?.[1]).toEqual(imageBlock);
  });

  it('compresses JSON arrays using the json strategy', async () => {
    setCachedSystemConfig({
      toolResultCompression: {
        enabled: true,
        minTokens: 1,
        maxOutputTokens: 160,
        strategy: 'json',
      },
    });

    const items = Array.from({ length: 80 }, (_value, index) => ({
      id: index,
      name: `item-${index}`,
      body: largeLines(`body-${index}`, 5),
    }));

    const result = await maybeCompressToolResult({
      content: [{ type: 'text', text: JSON.stringify(items) }],
    });

    expect(result.content?.[0].text).toContain('strategy=json');
    expect(result.content?.[0].text).toContain('omitted_items=');
  });

  it('auto-detects search output', async () => {
    setCachedSystemConfig({
      toolResultCompression: {
        enabled: true,
        minTokens: 1,
        maxOutputTokens: 120,
        strategy: 'auto',
      },
    });

    const searchOutput = Array.from(
      { length: 120 },
      (_value, index) => `src/file${index % 3}.ts:${index + 1}:const value${index} = ${index};`,
    ).join('\n');

    const result = await maybeCompressToolResult({
      content: [{ type: 'text', text: searchOutput }],
    });

    expect(result.content?.[0].text).toContain('strategy=search');
  });

  it('does not misclassify timestamped logs as search output', async () => {
    setCachedSystemConfig({
      toolResultCompression: {
        enabled: true,
        minTokens: 1,
        maxOutputTokens: 140,
        strategy: 'auto',
      },
    });

    const logOutput = Array.from({ length: 120 }, (_value, index) => {
      const level = index % 10 === 0 ? 'ERROR' : 'INFO';
      return `2023-10-27 12:34:${String(index % 60).padStart(2, '0')} ${level} src/app.ts:${index + 1}: request ${index}`;
    }).join('\n');

    const result = await maybeCompressToolResult({
      content: [{ type: 'text', text: logOutput }],
    });

    expect(result.content?.[0].text).toContain('strategy=log');
    expect(result.content?.[0].text).not.toContain('strategy=search');
  });

  it('auto-detects diff output', async () => {
    setCachedSystemConfig({
      toolResultCompression: {
        enabled: true,
        minTokens: 1,
        maxOutputTokens: 120,
        strategy: 'auto',
      },
    });

    const diffOutput = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 1111111..2222222 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,120 +1,120 @@',
      ...Array.from({ length: 150 }, (_value, index) =>
        index % 3 === 0 ? `+added line ${index}` : ` context line ${index}`,
      ),
    ].join('\n');

    const result = await maybeCompressToolResult({
      content: [{ type: 'text', text: diffOutput }],
    });

    expect(result.content?.[0].text).toContain('strategy=diff');
  });

  it('preserves empty added and removed lines in diff output', async () => {
    setCachedSystemConfig({
      toolResultCompression: {
        enabled: true,
        minTokens: 1,
        maxOutputTokens: 600,
        strategy: 'diff',
      },
    });

    const diffOutput = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 1111111..2222222 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,120 +1,120 @@',
      ...Array.from({ length: 40 }, (_value, index) => ` context before ${index}`),
      '-',
      '+',
      '-removed line',
      '+added line',
      ...Array.from({ length: 120 }, (_value, index) => ` context after ${index}`),
    ].join('\n');

    const result = await maybeCompressToolResult({
      content: [{ type: 'text', text: diffOutput }],
    });

    expect(result.content?.[0].text).toContain('strategy=diff');
    expect(result.content?.[0].text).toContain('\n-\n');
    expect(result.content?.[0].text).toContain('\n+\n');
  });
});
