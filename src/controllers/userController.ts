import { deleteCredentialBindings } from '../services/credentialBindingService.js';
import { Request, Response } from 'express';
import { ApiResponse } from '../types/index.js';
import {
  getAllUsers,
  UserAdminConflict,
  getUserByUsername,
  createNewUser,
  updateUser,
  deleteUser,
  getUserCount,
  getAdminCount,
  checkReservedUsername,
} from '../services/userService.js';
import { validatePasswordStrength } from '../utils/passwordValidation.js';

// Admin permission check middleware function
const requireAdmin = async (req: Request, res: Response): Promise<boolean> => {
  const user = (req as any).user;
  if (!user || !user.isAdmin) {
    res.status(403).json({
      success: false,
      message: 'Admin privileges required',
    });
    return false;
  }
  return true;
};

// Get all users (admin only)
export const getUsers = async (req: Request, res: Response): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;

  try {
    const users = (await getAllUsers()).map(
      ({ password: _, suspendedAt: _suspendedAt, ...user }) => user,
    ); // Remove password from response
    const response: ApiResponse = {
      success: true,
      data: users,
    };
    res.json(response);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get users information',
    });
  }
};

// Get a specific user by username (admin only)
export const getUser = async (req: Request, res: Response): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;

  try {
    const { username } = req.params;
    if (!username) {
      res.status(400).json({
        success: false,
        message: 'Username is required',
      });
      return;
    }

    const user = await getUserByUsername(username);
    if (!user) {
      res.status(404).json({
        success: false,
        message: 'User not found',
      });
      return;
    }

    const { password: _, suspendedAt: _suspendedAt, ...userData } = user; // Remove password from response
    const response: ApiResponse = {
      success: true,
      data: userData,
    };
    res.json(response);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get user information',
    });
  }
};

// Create a new user (admin only)
export const createUser = async (req: Request, res: Response): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;

  try {
    const { username, password, isAdmin, email } = req.body;

    if (!username || !password) {
      res.status(400).json({
        success: false,
        message: 'Username and password are required',
      });
      return;
    }

    // Validate password strength
    const validationResult = validatePasswordStrength(password);
    if (!validationResult.isValid) {
      res.status(400).json({
        success: false,
        message: 'Password does not meet security requirements',
        errors: validationResult.errors,
      });
      return;
    }

    // Check username against reserved names (e.g. "system", "admin")
    const reservedError = checkReservedUsername(username);
    if (reservedError) {
      res.status(400).json({
        success: false,
        message: reservedError,
      });
      return;
    }

    const newUser = await createNewUser(username, password, isAdmin || false, email);
    if (!newUser) {
      res.status(400).json({
        success: false,
        message: 'Failed to create user or username already exists',
      });
      return;
    }

    const { password: _, suspendedAt: _suspendedAt, ...userData } = newUser; // Remove password from response
    const response: ApiResponse = {
      success: true,
      data: userData,
      message: 'User created successfully',
    };
    res.status(201).json(response);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Update an existing user (admin only)
export const updateExistingUser = async (req: Request, res: Response): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;

  try {
    const { username } = req.params;
    const { isAdmin, newPassword, email, userGroups, disabled } = req.body;
    if (
      (disabled !== undefined && typeof disabled !== 'boolean') ||
      (isAdmin !== undefined && typeof isAdmin !== 'boolean')
    ) {
      res.status(400).json({ success: false, message: 'disabled and isAdmin must be boolean' });
      return;
    }
    if (
      userGroups !== undefined &&
      (!Array.isArray(userGroups) ||
        !userGroups.every((name: unknown) => typeof name === 'string' && name.trim().length > 0))
    ) {
      res
        .status(400)
        .json({ success: false, message: 'userGroups must be an array of non-empty strings' });
      return;
    }

    if (!username) {
      res.status(400).json({
        success: false,
        message: 'Username is required',
      });
      return;
    }

    const updateData: Parameters<typeof updateUser>[1] = {};
    if (disabled !== undefined) updateData.disabled = disabled;
    if (userGroups !== undefined)
      updateData.userGroups = [...new Set<string>(userGroups.map((name: string) => name.trim()))];
    if (isAdmin !== undefined) updateData.isAdmin = isAdmin;
    if (email !== undefined) updateData.email = email;
    if (newPassword) {
      // Validate new password strength
      const validationResult = validatePasswordStrength(newPassword);
      if (!validationResult.isValid) {
        res.status(400).json({
          success: false,
          message: 'Password does not meet security requirements',
          errors: validationResult.errors,
        });
        return;
      }
      updateData.newPassword = newPassword;
    }

    if (Object.keys(updateData).length === 0) {
      res.status(400).json({
        success: false,
        message: 'At least one update field is required',
      });
      return;
    }

    const updatedUser = await updateUser(
      username,
      updateData,
      (req as Request & { user?: { username: string } }).user?.username,
    );
    if (!updatedUser) {
      res.status(404).json({
        success: false,
        message: 'User not found or update failed',
      });
      return;
    }

    const { password: _, suspendedAt: _suspendedAt, ...userData } = updatedUser; // Remove password from response
    const response: ApiResponse = {
      success: true,
      data: userData,
      message: 'User updated successfully',
    };
    res.json(response);
  } catch (error) {
    if (error instanceof UserAdminConflict) {
      res.status(409).json({ success: false, message: error.message });
      return;
    }
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Delete a user (admin only)
export const deleteExistingUser = async (req: Request, res: Response): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;

  try {
    const { username } = req.params;
    if (!username) {
      res.status(400).json({
        success: false,
        message: 'Username is required',
      });
      return;
    }

    // Check if trying to delete the current admin user
    const currentUser = (req as any).user;
    if (currentUser.username === username) {
      res.status(400).json({
        success: false,
        message: 'Cannot delete your own account',
      });
      return;
    }

    const success = await deleteUser(username, currentUser.username);
    if (success) await deleteCredentialBindings({ username });
    if (!success) {
      res.status(400).json({
        success: false,
        message: 'User not found, failed to delete, or cannot delete the last admin',
      });
      return;
    }

    res.json({
      success: true,
      message: 'User deleted successfully',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get user statistics (admin only)
export const getUserStats = async (req: Request, res: Response): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;

  try {
    const totalUsers = await getUserCount();
    const adminUsers = await getAdminCount();
    const regularUsers = totalUsers - adminUsers;

    const response: ApiResponse = {
      success: true,
      data: {
        totalUsers,
        adminUsers,
        regularUsers,
      },
    };
    res.json(response);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get user statistics',
    });
  }
};
