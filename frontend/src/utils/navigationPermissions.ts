type UserLike = {
  isAdmin?: boolean;
} | null | undefined;

export const canViewSystemLogs = (user: UserLike): boolean => Boolean(user?.isAdmin);

export const canAccessAdminPages = (user: UserLike): boolean => Boolean(user?.isAdmin);
