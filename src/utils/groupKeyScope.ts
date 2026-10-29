/**
 * Bearer keys scope groups by name or ID. When a group is renamed, entries holding
 * its old name are moved to the new name. Returns the keys that changed.
 */
export const moveGroupKeyScopes = <K extends { allowedGroups?: string[] | null }>(
  keys: K[],
  oldName: string,
  newName: string,
  groupIds: string[],
): K[] => {
  // An entry equal to an existing group's ID is an ID reference, not this group's old name.
  if (groupIds.includes(oldName)) return [];
  return keys.filter((key) => {
    if (!key.allowedGroups?.includes(oldName)) return false;
    key.allowedGroups = key.allowedGroups.map((entry) => (entry === oldName ? newName : entry));
    return true;
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
