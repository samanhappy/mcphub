type UserLike = {
  isAdmin?: boolean;
} | null | undefined;

export const canViewSystemLogs = (user: UserLike): boolean => Boolean(user?.isAdmin);
