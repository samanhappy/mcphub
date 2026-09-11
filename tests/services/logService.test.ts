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
    const ts = Date.UTC(2026, 8, 11, 8, 15, 59, 327); // 2026-09-11T08:15:59.327Z

    const output = formatTimestamp(ts);

    // Explicit numeric offset, never the bare `Z` form of the old toISOString() output.
    expect(output).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);

    // Wall clock must match an independent ICU reference computed in the process timezone.
    const parts = new Intl.DateTimeFormat('en-CA', {
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(ts));
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? '';
    const referenceWallClock =
      `${get('year')}-${get('month')}-${get('day')}` +
      `T${get('hour')}:${get('minute')}:${get('second')}.327`;

    // Offset must reflect the same process timezone at that instant.
    const offsetMinutes = -new Date(ts).getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const absOffset = Math.abs(offsetMinutes);
    const offsetHH = String(Math.floor(absOffset / 60)).padStart(2, '0');
    const offsetMM = String(absOffset % 60).padStart(2, '0');

    expect(output).toBe(`${referenceWallClock}${sign}${offsetHH}:${offsetMM}`);

    // Round-trips through Date.parse back to the exact original instant.
    expect(Date.parse(output)).toBe(ts);
  });
});
