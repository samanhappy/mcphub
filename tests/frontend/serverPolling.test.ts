import { createServerPollingPolicy } from '../../frontend/src/utils/serverPolling';

const server = (status: string) => ({ name: 'alpha', status });

describe('server polling policy', () => {
  it('polls rapidly until three stable samples, then detects later changes', () => {
    const policy = createServerPollingPolicy();
    expect(policy.success([server('connected')])).toBe(2000);
    expect(policy.success([server('connected')])).toBe(2000);
    expect(policy.success([server('connected')])).toBe(30000);
    expect(policy.success([server('disconnected')])).toBe(2000);
  });

  it('keeps connecting servers fast but caps each window at one minute', () => {
    let now = 0;
    const policy = createServerPollingPolicy(() => now);
    for (let i = 0; i < 5; i++) expect(policy.success([server('connecting')])).toBe(2000);
    now = 60000;
    expect(policy.success([server('connecting')])).toBe(30000);
    expect(policy.success([server('connecting')])).toBe(30000);
    expect(policy.success([server('connected')])).toBe(2000);
  });

  it('caps a burst even when server statuses keep changing', () => {
    let now = 0;
    const policy = createServerPollingPolicy(() => now);
    expect(policy.success([server('connecting')])).toBe(2000);
    now = 59000;
    expect(policy.success([server('connected')])).toBe(2000);
    now = 60000;
    expect(policy.success([server('connecting')])).toBe(30000);
  });

  it('ignores list order and tracks servers outside the current page', () => {
    const policy = createServerPollingPolicy();
    const other = { name: 'beta', status: 'connected' };
    policy.success([server('connected'), other]);
    policy.success([other, server('connected')]);
    expect(policy.success([server('connected'), other])).toBe(30000);
    expect(policy.success([server('connected'), { ...other, status: 'connecting' }])).toBe(2000);
  });

  it.each([undefined, 'connecting', 'connected'])(
    'starts a fresh bounded fast window after a prolonged outage (previous: %s)',
    (previousStatus) => {
      let now = 0;
      const policy = createServerPollingPolicy(() => now);
      if (previousStatus) policy.success([server(previousStatus)]);
      policy.failure();
      now = 90000;
      policy.failure();
      expect(policy.success([server('connecting')])).toBe(2000);
      now = 149999;
      expect(policy.success([server('connecting')])).toBe(2000);
      now = 150000;
      expect(policy.success([server('connecting')])).toBe(30000);
    },
  );

  it('returns to normal after stable recovery without a status change', () => {
    let now = 0;
    const policy = createServerPollingPolicy(() => now);
    for (let i = 0; i < 3; i++) policy.success([server('connected')]);
    policy.failure();
    now = 90000;
    expect(policy.success([server('connected')])).toBe(2000);
    expect(policy.success([server('connected')])).toBe(2000);
    expect(policy.success([server('connected')])).toBe(30000);
  });

  it('backs off failures and resets the backoff after recovery', () => {
    const policy = createServerPollingPolicy();
    expect(Array.from({ length: 7 }, () => policy.failure())).toEqual([
      2000, 4000, 8000, 16000, 30000, 30000, 30000,
    ]);
    expect(policy.success([server('connected')])).toBe(2000);
    expect(policy.failure()).toBe(2000);
  });
});
