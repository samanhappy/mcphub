import type { IGroup, IUser } from '../types/index.js';
import { getDataService } from '../services/services.js';

// Missing visibility is the explicit legacy routing state (#914, #1167).
// Directory access continues to use ordinary filterData, including for legacy groups.
export const canAccessGroupRoute = (group: IGroup, user?: IUser): boolean =>
  group.visibility == null || getDataService().filterData([group], user).length > 0;

export const validateGroupAccess = (data: {
  visibility?: unknown;
  sharedWithUsers?: unknown;
  sharedWithUserGroups?: unknown;
}): string | null => {
  if (
    data.visibility !== undefined &&
    !['private', 'group', 'public'].includes(data.visibility as string)
  ) {
    return 'visibility must be private, group, or public';
  }
  for (const field of ['sharedWithUsers', 'sharedWithUserGroups'] as const) {
    const value = data[field];
    if (
      value !== undefined &&
      (!Array.isArray(value) ||
        !value.every((name: unknown) => typeof name === 'string' && name.trim().length > 0))
    )
      return `${field} must be an array of non-empty strings`;
  }
  return null;
};
