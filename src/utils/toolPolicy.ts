import type { ToolPolicyRule, PolicyDecision } from '../types/index.js';

type Subject = { username?: string; keyId?: string };
type Target = { groupId?: string; serverId?: string; tool?: string };
const selectors = ['username', 'keyId', 'groupId', 'serverId', 'tool'] as const;

export function validateToolPolicies(value: unknown): asserts value is ToolPolicyRule[] {
  if (!Array.isArray(value)) throw new Error('toolPolicies must be an array');
  const ids = new Set<string>();
  for (const rule of value) {
    if (
      !rule ||
      typeof rule !== 'object' ||
      Array.isArray(rule) ||
      typeof rule.id !== 'string' ||
      !rule.id.trim() ||
      ids.has(rule.id) ||
      !['allow', 'deny'].includes(rule.effect) ||
      Object.keys(rule).some((key) => !['id', 'effect', ...selectors].includes(key)) ||
      selectors.some(
        (key) => rule[key] !== undefined && (typeof rule[key] !== 'string' || !rule[key].trim()),
      )
    )
      throw new Error(
        'Invalid toolPolicies rule: use unique IDs, allow/deny and non-empty selectors',
      );
    ids.add(rule.id);
  }
}

export const evaluateToolPolicy = (
  rules: ToolPolicyRule[],
  subject: Subject,
  target: Target,
  potential = false,
): PolicyDecision => {
  const applicable = rules.filter(
    (rule) =>
      (!rule.username || rule.username === subject.username) &&
      (!rule.keyId || rule.keyId === subject.keyId),
  );
  const matches = (rule: ToolPolicyRule) =>
    (!rule.groupId || rule.groupId === target.groupId) &&
    (!rule.serverId || rule.serverId === target.serverId) &&
    (!rule.tool || (potential && target.tool === undefined) || rule.tool === target.tool);
  const deny = applicable.find(
    (rule) => rule.effect === 'deny' && matches(rule) && !(potential && rule.tool),
  );
  if (deny) return { decision: 'deny', reason: 'matching-deny', policyId: deny.id };
  const allows = applicable.filter((rule) => rule.effect === 'allow');
  const allow = allows.find(matches);
  if (allows.length && !allow) return { decision: 'deny', reason: 'no-matching-allow' };
  return {
    decision: 'allow',
    reason: allow ? 'matching-allow' : 'no-applicable-allow',
    policyId: allow?.id,
  };
};
