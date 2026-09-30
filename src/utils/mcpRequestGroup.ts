import { RequestContextService } from '../services/requestContextService.js';
import { getGroup } from '../services/sseService.js';

// An explicit empty group denotes the global route and must not fall back.
export const getMcpRequestGroup = (extra?: { group?: string; sessionId?: string }): string =>
  RequestContextService.getInstance().getGroupContext() ??
  extra?.group ??
  getGroup(extra?.sessionId || '') ??
  '';
