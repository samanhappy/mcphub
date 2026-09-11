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

describe('logService console timestamp formatting', () => {
  let logService: typeof import('../../src/services/logService.js').default;

  beforeAll(async () => {
    ({ default: logService } = await import('../../src/services/logService.js'));
  });

  it('renders console timestamps as ISO 8601 with the local UTC offset', () => {
    const formatTimestamp = (
      logService as unknown as { formatTimestamp(t: number): string }
    ).formatTimestamp.bind(logService);
    const ts = Date.UTC(2026, 8, 11, 8, 15, 59, 327); // 08:15:59.327Z
    const prevTz = process.env.TZ;

    try {
      process.env.TZ = 'Asia/Shanghai';
      expect(formatTimestamp(ts)).toBe('2026-09-11T16:15:59.327+08:00');

      process.env.TZ = 'America/New_York';
      expect(formatTimestamp(ts)).toBe('2026-09-11T04:15:59.327-04:00');

      process.env.TZ = 'UTC';
      expect(formatTimestamp(ts)).toBe('2026-09-11T08:15:59.327+00:00');
    } finally {
      if (prevTz === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = prevTz;
      }
    }
  });
});
