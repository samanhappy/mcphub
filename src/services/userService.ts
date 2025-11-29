import { IUser } from '../types/index.js';
import { getUserDao } from '../dao/index.js';

// Get all users
export const getAllUsers = async (): Promise<IUser[]> => {
  const userDao = getUserDao();
  return await userDao.findAll();
};

// Get user by username
export const getUserByUsername = async (username: string): Promise<IUser | undefined> => {
  const userDao = getUserDao();
  const user = await userDao.findByUsername(username);
  return user || undefined;
};

// Create a new user
export const createNewUser = async (
  username: string,
  password: string,
  isAdmin: boolean = false,
): Promise<IUser | null> => {
  try {
    const userDao = getUserDao();
    const existingUser = await userDao.findByUsername(username);
    if (existingUser) {
      return null; // User already exists
    }

    return await userDao.createWithHashedPassword(username, password, isAdmin);
  } catch (error) {
    console.error('Failed to create user:', error);
    return null;
  }
};

// Update user information
export const updateUser = async (
  username: string,
  data: { isAdmin?: boolean; newPassword?: string },
): Promise<IUser | null> => {
  try {
    const userDao = getUserDao();
    const user = await userDao.findByUsername(username);

    if (!user) {
      return null;
    }

    // Update admin status if provided
    if (data.isAdmin !== undefined) {
      const result = await userDao.update(username, { isAdmin: data.isAdmin });
      if (!result) {
        return null;
      }
    }

    // Update password if provided
    if (data.newPassword) {
      const success = await userDao.updatePassword(username, data.newPassword);
      if (!success) {
        return null;
      }
    }

    // Return updated user
    return await userDao.findByUsername(username);
  } catch (error) {
    console.error('Failed to update user:', error);
    return null;
  }
};

// Delete a user
export const deleteUser = async (username: string): Promise<boolean> => {
  try {
    const userDao = getUserDao();

    // Cannot delete the last admin user
    const users = await userDao.findAll();
    const adminUsers = users.filter((user) => user.isAdmin);
    const userToDelete = users.find((user) => user.username === username);

    if (userToDelete?.isAdmin && adminUsers.length === 1) {
      return false; // Cannot delete the last admin
    }

    return await userDao.delete(username);
  } catch (error) {
    console.error('Failed to delete user:', error);
    return false;
  }
};

// Check if user has admin permissions
export const isUserAdmin = async (username: string): Promise<boolean> => {
  const userDao = getUserDao();
  const user = await userDao.findByUsername(username);
  return user?.isAdmin || false;
};

// Get user count
export const getUserCount = async (): Promise<number> => {
  const userDao = getUserDao();
  return await userDao.count();
};

// Get admin count
export const getAdminCount = async (): Promise<number> => {
  const userDao = getUserDao();
  const admins = await userDao.findAdmins();
  return admins.length;
};
