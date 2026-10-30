/**
 * Bearer keys scope groups by name or ID. When a group is renamed, entries holding
 * its old name are moved to the new name in both allow lists and exclude lists.
 * Returns the keys that changed.
 */
export const moveGroupKeyScopes = <
  K extends { allowedGroups?: string[] | null; excludedGroups?: string[] | null },
>(
  keys: K[],
  oldName: string,
  newName: string,
  groupIds: string[],
): K[] => {
  // An entry equal to an existing group's ID is an ID reference, not this group's old name.
  if (groupIds.includes(oldName)) return [];
  return keys.filter((key) => {
    let changed = false;
    for (const field of ['allowedGroups', 'excludedGroups'] as const) {
      const entries = key[field];
      if (!entries?.includes(oldName)) continue;
      key[field] = entries.map((entry) => (entry === oldName ? newName : entry));
      changed = true;
    }
    return changed;
  });
};

/**
 * A group name must not equal another group's name, nor any group's ID: keys match
 * groups by either, so a name equal to an ID would let a key scoped to one group reach another.
 */
export const assertGroupNameAvailable = (
  groups: { id: string; name: string }[],
  id: string,
  name: string,
): void => {
  if (groups.some((group) => group.id !== id && group.name === name)) {
    throw new Error(`Group with name ${name} already exists`);
  }
  if (groups.some((group) => group.id === name)) {
    throw new Error(`Group name ${name} is already used as a group ID`);
  }
};
