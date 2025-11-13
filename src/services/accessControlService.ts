import { IUser, IGroup } from '../types/index.js';
import { loadSettings } from '../config/index.js';

/**
 * Access Control Service
 * Manages user permissions and access to groups
 */
export class AccessControlService {
  private static instance: AccessControlService;

  private constructor() {}

  public static getInstance(): AccessControlService {
    if (!AccessControlService.instance) {
      AccessControlService.instance = new AccessControlService();
    }
    return AccessControlService.instance;
  }

  /**
   * Check if a user has access to a specific group
   * @param user The user to check
   * @param groupId The group ID to check access for (can be group ID or group name)
   * @returns true if user has access, false otherwise
   */
  public canAccessGroup(user: IUser | null, groupId: string | undefined): boolean {
    // If no group specified (global route), check if user is admin
    if (!groupId) {
      return user?.isAdmin === true;
    }

    // If user is admin, they have access to all groups
    if (user?.isAdmin === true) {
      return true;
    }

    // If no user context (anonymous), deny access
    if (!user) {
      return false;
    }

    // Check if group exists
    const group = this.getGroupById(groupId);
    if (!group) {
      return false;
    }

    // Check if user is the owner of the group
    if (group.owner === user.username) {
      return true;
    }

    // Check if user has explicit permission via allowedGroups
    if (user.allowedGroups && user.allowedGroups.length > 0) {
      return user.allowedGroups.includes(group.id);
    }

    // By default, regular users without explicit permissions have no access
    return false;
  }

  /**
   * Get a group by ID or name
   * @param groupIdOrName Group ID or group name
   * @returns The group if found, null otherwise
   */
  private getGroupById(groupIdOrName: string): IGroup | null {
    try {
      const settings = loadSettings();
      const groups = settings.groups || [];

      // Try to find by ID first
      let group = groups.find((g) => g.id === groupIdOrName);

      // If not found, try by name
      if (!group) {
        group = groups.find((g) => g.name === groupIdOrName);
      }

      return group || null;
    } catch (error) {
      console.error('Error loading groups:', error);
      return null;
    }
  }

  /**
   * Get user by username from settings
   * @param username Username to look up
   * @returns The user if found, null otherwise
   */
  public getUserByUsername(username: string): IUser | null {
    try {
      const settings = loadSettings();
      const users = settings.users || [];
      const user = users.find((u) => u.username === username);
      return user || null;
    } catch (error) {
      console.error('Error loading user:', error);
      return null;
    }
  }

  /**
   * Get all groups a user has access to
   * @param user The user to check
   * @returns Array of group IDs the user can access
   */
  public getUserAccessibleGroups(user: IUser | null): string[] {
    if (!user) {
      return [];
    }

    // Admins have access to all groups
    if (user.isAdmin === true) {
      try {
        const settings = loadSettings();
        const groups = settings.groups || [];
        return groups.map((g) => g.id);
      } catch (error) {
        console.error('Error loading groups:', error);
        return [];
      }
    }

    // Regular users: return allowed groups + owned groups
    const settings = loadSettings();
    const groups = settings.groups || [];

    const accessibleGroups = new Set<string>();

    // Add explicitly allowed groups
    if (user.allowedGroups) {
      user.allowedGroups.forEach((groupId) => accessibleGroups.add(groupId));
    }

    // Add owned groups
    groups
      .filter((g) => g.owner === user.username)
      .forEach((g) => accessibleGroups.add(g.id));

    return Array.from(accessibleGroups);
  }

  /**
   * Check if user can access global routes (no group specified)
   * @param user The user to check
   * @returns true if user can access global routes
   */
  public canAccessGlobalRoute(user: IUser | null): boolean {
    // Only admins can access global routes
    return user?.isAdmin === true;
  }
}

export default AccessControlService;
