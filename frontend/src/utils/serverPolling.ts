const FAST_INTERVAL = 2000;
const NORMAL_INTERVAL = 30000;
const FAST_WINDOW = 60000;
const STABLE_SAMPLES = 3;

type ServerStatus = { name: string; status: string };

// One policy per polling session; explicit refreshes start a new fast window.
export const createServerPollingPolicy = (now = Date.now) => {
  let fastUntil = now() + FAST_WINDOW;
  let fast = true;
  let previous: string | undefined;
  let stableSamples = 0;
  let failures = 0;

  return {
    success(servers: ServerStatus[]): number {
      const signature = JSON.stringify(
        servers.map(({ name, status }) => [name, status]).sort(([a], [b]) => a.localeCompare(b)),
      );
      // Only actual changes reopen an expired window. A persistently connecting
      // server must not keep the whole dashboard polling rapidly forever.
      if (!fast && previous !== undefined && previous !== signature) {
        fastUntil = now() + FAST_WINDOW;
      }
      stableSamples = signature === previous ? stableSamples + 1 : 1;
      previous = signature;
      failures = 0;
      const connecting = servers.some((server) => server.status === 'connecting');
      fast = now() < fastUntil && (connecting || stableSamples < STABLE_SAMPLES);
      return fast ? FAST_INTERVAL : NORMAL_INTERVAL;
    },
    failure(): number {
      stableSamples = 0;
      failures += 1;
      return Math.min(NORMAL_INTERVAL, FAST_INTERVAL * 2 ** Math.min(failures - 1, 4));
    },
  };
};
