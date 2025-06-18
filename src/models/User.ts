import bcrypt from 'bcryptjs';
import { IUser } from '../types/index.js';
import { loadSettings, saveSettings } from '../config/index.js';

// Get all users
export const getUsers = (): IUser[] => {
  try {
    const settings = loadSettings();
    return settings.users || [];
  } catch (error) {
    console.error('Error reading users from settings:', error);
    return [];
  }
};

// Save users to settings
const saveUsers = (users: IUser[]): void => {
  try {
    const settings = loadSettings();
    settings.users = users;
    saveSettings(settings);
  } catch (error) {
    console.error('Error saving users to settings:', error);
  }
};

// Create a new user
export const createUser = async (userData: IUser): Promise<IUser | null> => {
  const users = getUsers();

  // Check if username already exists
  if (users.some((user) => user.username === userData.username)) {
    return null;
  }

  // Hash the password
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(userData.password, salt);

  const newUser = {
    username: userData.username,
    password: hashedPassword,
    isAdmin: userData.isAdmin || false,
  };

  users.push(newUser);
  saveUsers(users);

  return newUser;
};

// Find user by username
export const findUserByUsername = (username: string): IUser | undefined => {
  const users = getUsers();
  return users.find((user) => user.username === username);
};

// Verify user password
export const verifyPassword = async (
  plainPassword: string,
  hashedPassword: string,
): Promise<boolean> => {
  return await bcrypt.compare(plainPassword, hashedPassword);
};

// Update user password
export const updateUserPassword = async (
  username: string,
  newPassword: string,
): Promise<boolean> => {
  const users = getUsers();
  const userIndex = users.findIndex((user) => user.username === username);

  if (userIndex === -1) {
    return false;
  }

  // Hash the new password
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(newPassword, salt);

  // Update the user's password
  users[userIndex].password = hashedPassword;
  saveUsers(users);

  return true;
};

// Initialize with default admin user if no users exist
export const initializeDefaultUser = async (): Promise<void> => {
  const users = getUsers();

  if (users.length === 0) {
    await createUser({
      username: 'admin',
      password: 'admin123',
      isAdmin: true,
    });
    console.log('Default admin user created');
  }
};
