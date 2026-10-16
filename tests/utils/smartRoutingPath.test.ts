import { validateServerName } from '../../src/utils/serverNameValidation.js';
import {
  getSmartRoutingPath,
  normalizeSmartRoutingGroup,
  assertSmartRoutingSettingsAvailable,
} from '../../src/utils/smartRoutingPath.js';

const original = process.env.SMART_ROUTING_PATH;
afterEach(() => {
  if (original === undefined) delete process.env.SMART_ROUTING_PATH;
  else process.env.SMART_ROUTING_PATH = original;
});

it('defaults to the legacy path', () => {
  delete process.env.SMART_ROUTING_PATH;
  expect(getSmartRoutingPath()).toBe('$smart');
  expect(normalizeSmartRoutingGroup('$smart/team')).toBe('$smart/team');
});

it.each(['', 'a/b', '../smart', 'https://host', ' smart', 'smart?', 'a'.repeat(65)])(
  'rejects invalid path %j',
  (value) => {
    process.env.SMART_ROUTING_PATH = value;
    expect(getSmartRoutingPath).toThrow('SMART_ROUTING_PATH');
  },
);

it('normalizes only a complete alias segment and retains the legacy path', () => {
  process.env.SMART_ROUTING_PATH = 'my_smart';
  for (const [input, expected] of [
    ['my_smart', '$smart'],
    ['my_smart/team', '$smart/team'],
    ['$smart/team', '$smart/team'],
    ['my_smart-other', 'my_smart-other'],
    ['team/my_smart', 'team/my_smart'],
    [undefined, undefined],
  ])
    expect(normalizeSmartRoutingGroup(input)).toBe(expected);
});

it('rejects collisions in server names, group names and group IDs', () => {
  process.env.SMART_ROUTING_PATH = 'my_smart';
  for (const settings of [
    { mcpServers: { my_smart: {} } },
    { mcpServers: {}, groups: [{ id: 'team', name: 'my_smart', servers: [] }] },
    { mcpServers: {}, groups: [{ id: 'my_smart', name: 'team', servers: [] }] },
  ])
    expect(() => assertSmartRoutingSettingsAvailable(settings)).toThrow('reserved');
  expect(() => assertSmartRoutingSettingsAvailable({ mcpServers: { smart: {} } })).not.toThrow();
});

it('reports reserved server names through the existing name validator', () => {
  process.env.SMART_ROUTING_PATH = 'my_smart';
  expect(validateServerName('my_smart')).toMatchObject({
    valid: false,
    message: expect.stringContaining('SMART_ROUTING_PATH'),
  });
  expect(validateServerName('smart')).toMatchObject({ valid: true });
});
