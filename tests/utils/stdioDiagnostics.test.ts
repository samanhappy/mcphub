import { EventEmitter } from 'node:events';
import {
  addStdioErrorContext,
  getStdioStderrTail,
  observeStdioStderr,
} from '../../src/utils/stdioDiagnostics.js';
import { summarizeErrorForLogging } from '../../src/utils/serialization.js';

class FakeStderr extends EventEmitter {}

describe('stdio diagnostics', () => {
  it('captures chunked stderr as sanitized lines and preserves the complete tail', () => {
    const transport = {};
    const stderr = new FakeStderr();
    const logLine = jest.fn();

    observeStdioStderr(transport, stderr, logLine);
    stderr.emit('data', Buffer.from('Traceback (most recent call last):\nImport'));
    stderr.emit('data', Buffer.from('Error: token=super-secret\n'));
    stderr.emit('end');

    expect(logLine).toHaveBeenNthCalledWith(1, 'Traceback (most recent call last):');
    expect(logLine).toHaveBeenNthCalledWith(2, 'ImportError: token=[REDACTED]');
    expect(getStdioStderrTail(transport)).toBe(
      'Traceback (most recent call last):\nImportError: token=[REDACTED]',
    );
  });

  it('keeps only the most recent stderr when output exceeds the diagnostic limit', () => {
    const transport = {};
    const stderr = new FakeStderr();

    observeStdioStderr(transport, stderr, jest.fn());
    stderr.emit('data', Buffer.from(`${'x'.repeat(40_000)}FINAL_ERROR`));

    const tail = getStdioStderrTail(transport);
    expect(tail?.length).toBeLessThanOrEqual(32_768);
    expect(tail?.endsWith('FINAL_ERROR')).toBe(true);
  });

  it('adds captured stderr to connection errors so existing logging includes the cause', () => {
    const transport = {};
    const stderr = new FakeStderr();
    const error = Object.assign(new Error('MCP error -32000: Connection closed'), {
      code: -32000,
    });

    observeStdioStderr(transport, stderr, jest.fn());
    stderr.emit('data', Buffer.from('ImportError: cannot import name McpError\n'));

    const contextualError = addStdioErrorContext(error, transport);

    expect(summarizeErrorForLogging(contextualError)).toEqual(
      expect.objectContaining({
        code: -32000,
        upstreamStderr: 'ImportError: cannot import name McpError',
      }),
    );
  });
});
