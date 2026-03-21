describe('logService error serialization', () => {
  let logService: typeof import('../../src/services/logService.js').default;

  beforeAll(async () => {
    ({ default: logService } = await import('../../src/services/logService.js'));
  });

  beforeEach(() => {
    logService.clearLogs();
  });

  it('keeps nested Error details when logging structured objects', () => {
    const error = new Error('structured failure');
    (error as Error & { code?: string }).code = 'E_STRUCTURED';

    console.error('Structured log failure', {
      requestId: 'req-123',
      error,
    });

    const lastLog = logService.getLogs().at(-1);

    expect(lastLog).toBeDefined();
    expect(lastLog?.message).toContain('Structured log failure');
    expect(lastLog?.message).toContain('structured failure');
    expect(lastLog?.message).toContain('E_STRUCTURED');
    expect(lastLog?.message).not.toContain('"error": {}');
  });
});
