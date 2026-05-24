import os from 'node:os';

export interface HostedNodeIdentity {
  clusterId?: string;
  nodeId: string;
}

export function getHostedNodeIdentity(): HostedNodeIdentity {
  return {
    clusterId: process.env.HUB_CLUSTER_ID || undefined,
    nodeId: process.env.HUB_NODE_ID || os.hostname(),
  };
}
