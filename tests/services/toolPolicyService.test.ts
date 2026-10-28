import { evaluateToolPolicy, validateToolPolicies } from '../../src/utils/toolPolicy.js';

describe('tool policy contract', () => {
  const allow = {
    id: 'read',
    effect: 'allow' as const,
    keyId: 'agent',
    serverId: 'a',
    tool: 'read',
  };
  const subject = { username: 'admin', keyId: 'agent' };
  test('scopes the allow-list by subject before matching the target', () => {
    expect(evaluateToolPolicy([allow], subject, { serverId: 'a', tool: 'read' }).decision).toBe(
      'allow',
    );
    for (const target of [
      { serverId: 'b', tool: 'read' },
      { serverId: 'a', tool: 'new_tool' },
    ]) {
      expect(evaluateToolPolicy([allow], subject, target)).toMatchObject({
        decision: 'deny',
        reason: 'no-matching-allow',
      });
    }
    expect(evaluateToolPolicy([allow], { username: 'other' }, { serverId: 'b' }).decision).toBe(
      'allow',
    );
  });
  test('deny wins, multiple allows form a union, and subject selectors intersect', () => {
    const rules = [
      allow,
      { ...allow, id: 'other', serverId: 'b' },
      { id: 'deny', effect: 'deny' as const, username: 'admin', tool: 'read' },
    ];
    expect(evaluateToolPolicy(rules, subject, { serverId: 'b', tool: 'read' })).toMatchObject({
      decision: 'deny',
      policyId: 'deny',
    });
    expect(
      evaluateToolPolicy(rules.slice(0, 2), subject, { serverId: 'b', tool: 'read' }).decision,
    ).toBe('allow');
    expect(
      evaluateToolPolicy([{ ...allow, username: 'alice' }], subject, { serverId: 'b' }).decision,
    ).toBe('allow');
  });
  test('global subject rules apply and group-only grants cannot cross routes', () => {
    const rules = [{ id: 'group', effect: 'allow' as const, groupId: 'g' }];
    expect(evaluateToolPolicy(rules, subject, { groupId: 'g', serverId: 'a' }).decision).toBe(
      'allow',
    );
    expect(evaluateToolPolicy(rules, subject, { serverId: 'a' }).decision).toBe('deny');
    expect(
      evaluateToolPolicy([{ id: 'deny', effect: 'deny', serverId: 'b' }], subject, {
        serverId: 'a',
      }).decision,
    ).toBe('allow');
  });
  test.each([
    null,
    {},
    [{ id: 'x', effect: 'typo' }],
    [{ id: 'x', effect: 'allow', tool: '' }],
    [{ id: 'x', effect: 'allow', server: 'typo' }],
    [
      { id: 'x', effect: 'allow' },
      { id: 'x', effect: 'deny' },
    ],
  ])('rejects malformed rules: %j', (rules) => {
    expect(() => validateToolPolicies(rules)).toThrow();
  });
});
