type ServerLike = {
  owner?: string;
};

type UserLike = {
  username: string;
  isAdmin?: boolean;
} | null | undefined;

export const canManageServer = (server: ServerLike, user: UserLike): boolean => {
  if (!user) {
    return false;
  }

  if (user.isAdmin) {
    return true;
  }

  return Boolean(server.owner && server.owner === user.username);
};
