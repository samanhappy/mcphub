import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { validationResult } from 'express-validator';
import {
  findUserByUsername,
  verifyPassword,
  createUser,
  updateUserPassword,
} from '../models/User.js';
import { getDataService } from '../services/services.js';
import { DataService } from '../services/dataService.js';

const dataService: DataService = getDataService();

// Default secret key - in production, use an environment variable
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';
const TOKEN_EXPIRY = '24h';

// Login user
export const login = async (req: Request, res: Response): Promise<void> => {
  // Get translation function from request
  const t = (req as any).t;

  // Validate request
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({
      success: false,
      message: t('api.errors.validation_failed'),
      errors: errors.array(),
    });
    return;
  }

  const { username, password } = req.body;

  try {
    // Find user by username
    const user = findUserByUsername(username);

    if (!user) {
      res.status(401).json({
        success: false,
        message: t('api.errors.invalid_credentials'),
      });
      return;
    }

    // Verify password
    const isPasswordValid = await verifyPassword(password, user.password);

    if (!isPasswordValid) {
      res.status(401).json({
        success: false,
        message: t('api.errors.invalid_credentials'),
      });
      return;
    }

    // Generate JWT token
    const payload = {
      user: {
        username: user.username,
        isAdmin: user.isAdmin || false,
      },
    };

    jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY }, (err, token) => {
      if (err) throw err;
      res.json({
        success: true,
        message: t('api.success.login_successful'),
        token,
        user: {
          username: user.username,
          isAdmin: user.isAdmin,
          permissions: dataService.getPermissions(user),
        },
      });
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: t('api.errors.server_error'),
    });
  }
};

// Register new user
export const register = async (req: Request, res: Response): Promise<void> => {
  // Get translation function from request
  const t = (req as any).t;

  // Validate request
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({
      success: false,
      message: t('api.errors.validation_failed'),
      errors: errors.array(),
    });
    return;
  }

  const { username, password, isAdmin } = req.body;

  try {
    // Create new user
    const newUser = await createUser({ username, password, isAdmin });

    if (!newUser) {
      res.status(400).json({ success: false, message: 'User already exists' });
      return;
    }

    // Generate JWT token
    const payload = {
      user: {
        username: newUser.username,
        isAdmin: newUser.isAdmin || false,
      },
    };

    jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY }, (err, token) => {
      if (err) throw err;
      res.json({
        success: true,
        token,
        user: {
          username: newUser.username,
          isAdmin: newUser.isAdmin,
          permissions: dataService.getPermissions(newUser),
        },
      });
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Get current user
export const getCurrentUser = (req: Request, res: Response): void => {
  try {
    // User is already attached to request by auth middleware
    const user = (req as any).user;

    res.json({
      success: true,
      user: {
        username: user.username,
        isAdmin: user.isAdmin,
        permissions: dataService.getPermissions(user),
      },
    });
  } catch (error) {
    console.error('Get current user error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Change password
export const changePassword = async (req: Request, res: Response): Promise<void> => {
  // Validate request
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ success: false, errors: errors.array() });
    return;
  }

  const { currentPassword, newPassword } = req.body;
  const username = (req as any).user.username;

  try {
    // Find user by username
    const user = findUserByUsername(username);

    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    // Verify current password
    const isPasswordValid = await verifyPassword(currentPassword, user.password);

    if (!isPasswordValid) {
      res.status(401).json({ success: false, message: 'Current password is incorrect' });
      return;
    }

    // Update the password
    const updated = await updateUserPassword(username, newPassword);

    if (!updated) {
      res.status(500).json({ success: false, message: 'Failed to update password' });
      return;
    }

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
