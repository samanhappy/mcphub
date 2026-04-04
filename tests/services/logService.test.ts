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

  it('redacts direct remote HTTP errors when logging Error instances', () => {
    const error = Object.assign(new Error('oauth access_token=top-secret'), {
      code: 'ERR_BAD_REQUEST',
      response: {
        status: 400,
        data: {
          access_token: 'top-secret',
        },
        headers: {
          'x-request-id': 'req-remote',
        },
      },
    });

    console.error('OAuth exchange failed:', error);

    const lastLog = logService.getLogs().at(-1);

    expect(lastLog).toBeDefined();
    expect(lastLog?.message).toContain('OAuth exchange failed:');
    expect(lastLog?.message).toContain('[Remote request failed; response details omitted]');
    expect(lastLog?.message).toContain('"status": 400');
    expect(lastLog?.message).toContain('"requestId": "req-remote"');
    expect(lastLog?.message).not.toContain('top-secret');
  });
});
