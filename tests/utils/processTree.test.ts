// Direct coverage for the process-table reader behind the stdio termination
// wait. The pids it returns are signalled individually, outside any live tree
// walk, so its parsing and its refusals are load-bearing: a wrong pid here is
// a SIGKILL sent to a process nobody asked about.
jest.mock('fs', () => ({
  __esModule: true,
  default: {
    readdirSync: jest.fn(),
    readFileSync: jest.fn(),
    accessSync: jest.fn(),
    constants: { X_OK: 1 },
  },
}));

const mockExecFileSync = jest.fn();
jest.mock('child_process', () => ({
  __esModule: true,
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
}));

import fs from 'fs';
import {
  captureProcessTreeSync,
  readProcessStartTimesSync,
  resetProcessListingCacheForTest,
  UNKNOWN_START_TIME,
} from '../../src/utils/processTree.js';

const mockReaddir = fs.readdirSync as unknown as jest.Mock;
const mockReadFile = fs.readFileSync as unknown as jest.Mock;

const originalPlatform = process.platform;

const setPlatform = (platform: string): void => {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
};

// Fields of /proc/<pid>/stat up to the ones this code reads: pid, comm, state,
// ppid, then filler up to starttime (field 22).
const statLine = (pid: number, comm: string, ppid: number, startedAt: string): string => {
  const fields = [String(pid), `(${comm})`, 'S', String(ppid)];
  // Fields 5..21 are not read; any value will do.
  for (let field = 5; field <= 21; field += 1) {
    fields.push('0');
  }
  fields.push(startedAt);
  return fields.join(' ') + '\n';
};

// A /proc where each entry is `[pid, comm, ppid, starttime]`.
const fakeProc = (rows: Array<[number, string, number, string]>): void => {
  const byPid = new Map(rows.map((row) => [row[0], row]));
  mockReaddir.mockImplementation(() => [
    ...rows.map((row) => String(row[0])),
    // /proc also holds non-numeric entries, which must be ignored.
    'self',
    'cpuinfo',
  ]);
  mockReadFile.mockImplementation((file: string) => {
    const pid = Number(String(file).replace(/\\/g, '/').split('/').slice(-2)[0]);
    const row = byPid.get(pid);
    if (!row) {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    }
    return statLine(row[0], row[1], row[2], row[3]);
  });
};

describe('captureProcessTreeSync on Linux', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetProcessListingCacheForTest();
    setPlatform('linux');
  });

  afterAll(() => {
    setPlatform(originalPlatform);
  });

  it('returns the whole subtree with the start time of each process', () => {
    fakeProc([
      [100, 'npm', 10, '1000'],
      [101, 'npx', 100, '1100'],
      [102, 'server', 101, '1200'],
      [200, 'unrelated', 10, '1300'],
    ]);

    const snapshot = captureProcessTreeSync(100);

    expect(snapshot.rootStartedAt).toBe('1000');
    expect(snapshot.descendants).toEqual([
      { pid: 101, startedAt: '1100' },
      { pid: 102, startedAt: '1200' },
    ]);
  });

  it('reads the right fields when the process name contains spaces and parentheses', () => {
    // `comm` is parenthesised and unescaped, so counting fields from the left
    // would put the parent pid and the start time one or more places out.
    fakeProc([
      [100, 'wrapper', 10, '1000'],
      [101, 'weird ) (name', 100, '1100'],
    ]);

    expect(captureProcessTreeSync(100).descendants).toEqual([{ pid: 101, startedAt: '1100' }]);
  });

  it('drops a row it cannot parse instead of guessing at it', () => {
    mockReaddir.mockReturnValue(['100', '101']);
    mockReadFile.mockImplementation((file: string) => {
      if (String(file).includes('101')) {
        // Truncated: no starttime field.
        return '101 (child) S 100\n';
      }
      return statLine(100, 'wrapper', 10, '1000');
    });

    const snapshot = captureProcessTreeSync(100);

    // Under-capturing leaves an orphan behind; mis-parsing would send a signal
    // to whatever pid the shifted fields happened to name.
    expect(snapshot.descendants).toEqual([]);
    expect(snapshot.rootStartedAt).toBe('1000');
  });

  it('never reports init, pid 0, or the hub itself as a descendant', () => {
    fakeProc([
      [100, 'wrapper', 10, '1000'],
      [1, 'init', 100, '1'],
      [process.pid, 'mcphub', 100, '1400'],
      [103, 'server', 100, '1500'],
    ]);

    expect(captureProcessTreeSync(100).descendants).toEqual([{ pid: 103, startedAt: '1500' }]);
  });

  it('refuses a root pid that could never be signalled safely', () => {
    fakeProc([[1, 'init', 0, '1']]);

    for (const pid of [0, 1, -5, 1.5, Number.NaN]) {
      expect(captureProcessTreeSync(pid)).toEqual({ descendants: [] });
    }
    expect(mockReaddir).not.toHaveBeenCalled();
  });

  it('reports nothing when the process table cannot be read', () => {
    mockReaddir.mockImplementation(() => {
      throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
    });

    // The caller then watches the root pid alone, which is what it did before
    // any of this existed.
    expect(captureProcessTreeSync(100)).toEqual({ descendants: [] });
  });

  it('does not reuse a listing between captures', () => {
    fakeProc([[100, 'wrapper', 10, '1000']]);

    captureProcessTreeSync(100);
    captureProcessTreeSync(100);

    // /proc is cheap, so every snapshot is current. The cached listing exists
    // only on the platforms that have to fork `ps`.
    expect(mockReaddir).toHaveBeenCalledTimes(2);
  });
});

describe('readProcessStartTimesSync on Linux', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetProcessListingCacheForTest();
    setPlatform('linux');
  });

  afterAll(() => {
    setPlatform(originalPlatform);
  });

  it('answers for the pids that still exist and leaves out the ones that do not', () => {
    fakeProc([
      [101, 'alive', 100, '1100'],
      [103, 'also-alive', 100, '1300'],
    ]);

    const startTimes = readProcessStartTimesSync([101, 102, 103]);

    expect(startTimes).not.toBeNull();
    expect([...(startTimes as Map<number, string>).entries()]).toEqual([
      [101, '1100'],
      [103, '1300'],
    ]);
  });

  it('ignores pids that must never be signalled', () => {
    fakeProc([[1, 'init', 0, '1']]);

    expect(readProcessStartTimesSync([0, 1, -3])).toEqual(new Map());
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  // ENOENT is an answer: that pid is gone. Any other read error is the kernel
  // declining to say, and leaving the pid out of the map would be reported to
  // the caller as "not the process you captured" — which is how a live process
  // stops being watched and gets called gone.
  // Per pid, not per batch: 101 is answered while 102 is marked unknown. A
  // batch-wide null would strand 101, which is how a stubborn orphan survives
  // beside an unrelated unreadable process.
  it.each([
    ['the stat file cannot be read', Object.assign(new Error('EACCES'), { code: 'EACCES' })],
    ['the read fails with no errno at all', new Error('nope')],
  ])('marks one pid unknown without losing the others when %s', (_label, failure) => {
    fakeProc([
      [101, 'alive', 100, '1100'],
      [102, 'hidden', 100, '1200'],
    ]);
    mockReadFile.mockImplementation((file: string) => {
      if (String(file).includes('102')) {
        throw failure;
      }
      return statLine(101, 'alive', 100, '1100');
    });

    const startTimes = readProcessStartTimesSync([101, 102]);

    expect(startTimes).not.toBeNull();
    expect(startTimes?.get(101)).toBe('1100');
    expect(startTimes?.get(102)).toBe(UNKNOWN_START_TIME);
    // Unknown is never a real start time, so a caller comparing it to a
    // captured token always sees a mismatch rather than a false match.
    expect(UNKNOWN_START_TIME).not.toBe('1200');
  });

  it('marks a pid unknown when its stat line will not parse', () => {
    fakeProc([[101, 'alive', 100, '1100']]);
    mockReadFile.mockImplementation(() => 'not a stat line\n');

    expect(readProcessStartTimesSync([101])?.get(101)).toBe(UNKNOWN_START_TIME);
  });

  // An absent pid is "gone", which is a different answer from "unknown" and
  // the whole reason the two are kept apart.
  it('leaves a pid the kernel reports as gone out of the map', () => {
    fakeProc([[101, 'alive', 100, '1100']]);

    const startTimes = readProcessStartTimesSync([101, 102]);

    expect(startTimes?.has(102)).toBe(false);
    expect(startTimes?.get(101)).toBe('1100');
  });

  // The /proc walk must NOT inherit that rule: on a hidepid host most entries
  // are unreadable, and poisoning the whole listing would leave every capture
  // empty and every reparented descendant alive.
  it('still captures the tree when other processes in /proc are unreadable', () => {
    fakeProc([
      [100, 'wrapper', 1, '1000'],
      [101, 'child', 100, '1100'],
      [900, 'someone-else', 1, '9000'],
    ]);
    mockReadFile.mockImplementation((file: string) => {
      if (String(file).includes('900')) {
        throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
      }
      const pid = Number(String(file).replace(/\\/g, '/').split('/').slice(-2)[0]);
      return statLine(pid, pid === 100 ? 'wrapper' : 'child', pid === 100 ? 1 : 100, `${pid}0`);
    });

    expect(captureProcessTreeSync(100).descendants).toEqual([{ pid: 101, startedAt: '1010' }]);
  });
});

// The `ps` branch is what runs on macOS and the BSDs, and it is the one place
// in this module that parses the output of an external command. It is also
// where the identity token is weakest, lstart resolving only to the second, so
// it gets the same direct coverage the /proc reader has.
describe('readProcessStartTimesSync and captureProcessTreeSync on darwin', () => {
  const lstart = (label: string): string => `Mon Nov 16 02:00:0${label} 2026`;

  beforeEach(() => {
    jest.clearAllMocks();
    resetProcessListingCacheForTest();
    setPlatform('darwin');
  });

  afterAll(() => {
    setPlatform(originalPlatform);
  });

  it('projects only pid, ppid and start time, never the command or its arguments', () => {
    mockExecFileSync.mockReturnValue(`  100     1 ${lstart('0')}\n  101   100 ${lstart('1')}\n`);

    expect(captureProcessTreeSync(100).descendants).toEqual([{ pid: 101, startedAt: lstart('1') }]);
    const [command, args] = mockExecFileSync.mock.calls[0];
    expect(command).toBe('ps');
    // A published MCP server may carry an API key in argv. Reading `comm` or
    // `args` here would put it in a log payload.
    expect(args).toEqual(['-A', '-o', 'pid=,ppid=,lstart=']);
  });

  // A successful listing is NEVER reused. Serving a snapshot from a listing
  // taken before the child was spawned would attribute that pid number to its
  // previous owner, hand this server the previous owner's surviving children as
  // its own captured descendants, and SIGKILL them: their start times are
  // genuinely unchanged, so they pass their own identity check.
  it('reads the table fresh for every capture', () => {
    mockExecFileSync.mockReturnValue(`  100     1 ${lstart('0')}\n  101   100 ${lstart('1')}\n`);

    captureProcessTreeSync(100);
    captureProcessTreeSync(100);
    captureProcessTreeSync(100);

    expect(mockExecFileSync).toHaveBeenCalledTimes(3);
  });

  // A hung `ps` costs the timeout per closing server, synchronously, so a
  // failure is cached for the same window as a success.
  it('caches a failing ps for the same window as a successful one', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    expect(captureProcessTreeSync(100)).toEqual({ descendants: [] });
    expect(captureProcessTreeSync(100)).toEqual({ descendants: [] });
    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
  });

  it('drops rows it cannot parse rather than shifting the columns', () => {
    mockExecFileSync.mockReturnValue(
      [
        'PID PPID STARTED',
        `  100     1 ${lstart('0')}`,
        'garbage',
        `  101   100 ${lstart('1')}`,
        '',
      ].join('\n'),
    );

    expect(captureProcessTreeSync(100).descendants).toEqual([{ pid: 101, startedAt: lstart('1') }]);
  });

  // Asks for the pids it was given rather than the whole table, and reads
  // which of them are gone off the answer: 102 is requested and simply does
  // not come back. The pid list is digits and commas only, since every entry
  // has already been through isSignallablePid.
  it('asks ps for the given pids and keeps lstart whole despite its spaces', () => {
    mockExecFileSync.mockReturnValue(`  101   100 ${lstart('1')}\n  103   100 ${lstart('3')}\n`);

    const startTimes = readProcessStartTimesSync([101, 102, 103]);

    expect(mockExecFileSync.mock.calls[0][1]).toEqual([
      '-o',
      'pid=,ppid=,lstart=',
      '-p',
      '101,102,103',
    ]);
    expect([...(startTimes as Map<number, string>).entries()]).toEqual([
      [101, lstart('1')],
      [103, lstart('3')],
    ]);
  });

  it('says it cannot establish identity when ps itself fails', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('no ps here');
    });

    expect(readProcessStartTimesSync([101])).toBeNull();
  });

  it('does not reuse the cached full listing for an identity check', () => {
    mockExecFileSync.mockReturnValue(`  100     1 ${lstart('0')}\n  101   100 ${lstart('1')}\n`);
    captureProcessTreeSync(100);

    mockExecFileSync.mockReturnValue(`  101   100 ${lstart('9')}\n`);
    const startTimes = readProcessStartTimesSync([101]);

    // Reading the identity off the same listing the capture came from would
    // make the comparison vacuous: it would always match.
    expect(startTimes?.get(101)).toBe(lstart('9'));
  });
});

describe('on win32', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetProcessListingCacheForTest();
    setPlatform('win32');
  });

  afterAll(() => {
    setPlatform(originalPlatform);
  });

  it('reads nothing: taskkill /T /F already ends the whole tree at the first signal', () => {
    expect(captureProcessTreeSync(100)).toEqual({ descendants: [] });
    expect(mockReaddir).not.toHaveBeenCalled();
  });

  it('reports a readable table that does not list the root as rootUnknown', () => {
    setPlatform('linux');
    // The root is not in /proc; its children are.
    fakeProc([
      [101, 'child', 100, '1100'],
      [102, 'grandchild', 101, '1200'],
    ]);

    const snapshot = captureProcessTreeSync(100);

    // Distinct from an unreadable table, which yields no descendants at all:
    // here the walk worked, so the missing token is the root's own absence and
    // the caller is entitled to be told it is signalling unchecked.
    expect(snapshot.rootStartedAt).toBeUndefined();
    expect(snapshot.rootUnknown).toBe(true);
    expect(snapshot.descendants).toEqual([
      { pid: 101, startedAt: '1100' },
      { pid: 102, startedAt: '1200' },
    ]);
    setPlatform('win32');
  });

  it('says it cannot establish identity, rather than reporting no matches', () => {
    // null is "I could not look". An empty map would read as "none of these
    // are the processes you captured", which is the opposite of safe when the
    // caller uses it to decide whether to send SIGKILL.
    expect(readProcessStartTimesSync([101])).toBeNull();
  });
});
