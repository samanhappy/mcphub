import { IUser } from '../types/index.js';
import { getUsers, createUser, findUserByUsername } from '../models/User.js';
import { saveSettings, loadSettings } from '../config/index.js';
import bcrypt from 'bcryptjs';

// Get all users
export const getAllUsers = (): IUser[] => {
  return getUsers();
};

// Get user by username
export const getUserByUsername = (username: string): IUser | undefined => {
  return findUserByUsername(username);
};

// Create a new user
export const createNewUser = async (
  username: string,
  password: string,
  isAdmin: boolean = false,
): Promise<IUser | null> => {
  try {
    const existingUser = findUserByUsername(username);
    if (existingUser) {
      return null; // User already exists
    }

    const userData: IUser = {
      username,
      password,
      isAdmin,
    };

    return await createUser(userData);
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
    const users = getUsers();
    const userIndex = users.findIndex((user) => user.username === username);

    if (userIndex === -1) {
      return null;
    }

    const user = users[userIndex];

    // Update admin status if provided
    if (data.isAdmin !== undefined) {
      user.isAdmin = data.isAdmin;
    }

    // Update password if provided
    if (data.newPassword) {
      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(data.newPassword, salt);
    }

    // Save users array back to settings
    const { saveSettings, loadSettings } = await import('../config/index.js');
    const settings = loadSettings();
    settings.users = users;

    if (!saveSettings(settings)) {
      return null;
    }

    return user;
  } catch (error) {
    console.error('Failed to update user:', error);
    return null;
  }
};

// Delete a user
export const deleteUser = (username: string): boolean => {
  try {
    // Cannot delete the last admin user
    const users = getUsers();
    const adminUsers = users.filter((user) => user.isAdmin);
    const userToDelete = users.find((user) => user.username === username);

    if (userToDelete?.isAdmin && adminUsers.length === 1) {
      return false; // Cannot delete the last admin
    }

    const filteredUsers = users.filter((user) => user.username !== username);

    if (filteredUsers.length === users.length) {
      return false; // User not found
    }

    // Save filtered users back to settings
    const settings = loadSettings();
    settings.users = filteredUsers;

    return saveSettings(settings);
  } catch (error) {
    console.error('Failed to delete user:', error);
    return false;
  }
};

// Check if user has admin permissions
export const isUserAdmin = (username: string): boolean => {
  const user = findUserByUsername(username);
  return user?.isAdmin || false;
};

// Get user count
export const getUserCount = (): number => {
  return getUsers().length;
};

// Get admin count
export const getAdminCount = (): number => {
  return getUsers().filter((user) => user.isAdmin).length;
};
