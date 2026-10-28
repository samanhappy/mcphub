export interface ToolPolicyRule {
  id: string;
  effect: 'allow' | 'deny';
  username?: string;
  keyId?: string;
  groupId?: string;
  serverId?: string;
  tool?: string;
}

export interface PolicyDecision {
  decision: 'allow' | 'deny';
  reason: string;
  policyId?: string;
}
