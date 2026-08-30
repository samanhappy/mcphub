export const getSelectableShareUsers = (
  selectedUsers: readonly string[] = [],
  shareCandidates: readonly string[] = [],
): string[] =>
  Array.from(new Set([...selectedUsers, ...shareCandidates])).sort((left, right) =>
    left.localeCompare(right),
  );

export const filterShareUsers = (users: readonly string[], query: string): string[] => {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [...users];
  }

  return users.filter((username) => username.toLowerCase().includes(normalizedQuery));
};

export const selectShareUsers = (
  selectedUsers: readonly string[],
  usersToSelect: readonly string[],
): string[] => Array.from(new Set([...selectedUsers, ...usersToSelect]));

export const deselectShareUsers = (
  selectedUsers: readonly string[],
  usersToDeselect: readonly string[],
): string[] => {
  const usersToRemove = new Set(usersToDeselect);
  return selectedUsers.filter((username) => !usersToRemove.has(username));
};
