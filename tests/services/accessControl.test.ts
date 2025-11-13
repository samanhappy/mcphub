import { AccessControlService } from '../../src/services/accessControlService.js';
import { IUser, IGroup } from '../../src/types/index.js';
import * as config from '../../src/config/index.js';

// Mock the config module
jest.mock('../../src/config/index.js');

describe('AccessControlService', () => {
  let accessControlService: AccessControlService;

  const mockAdminUser: IUser = {
    username: 'admin',
    password: 'hashedPassword',
    isAdmin: true,
  };

  const mockRegularUser: IUser = {
    username: 'user1',
    password: 'hashedPassword',
    isAdmin: false,
    allowedGroups: ['group-123'],
  };

  const mockUserWithoutGroups: IUser = {
    username: 'user2',
    password: 'hashedPassword',
    isAdmin: false,
  };

  const mockGroup1: IGroup = {
    id: 'group-123',
    name: 'Production',
    servers: ['server1', 'server2'],
    owner: 'admin',
  };

  const mockGroup2: IGroup = {
    id: 'group-456',
    name: 'Development',
    servers: ['server3'],
    owner: 'user1',
  };

  const mockSettings = {
    groups: [mockGroup1, mockGroup2],
    users: [mockAdminUser, mockRegularUser, mockUserWithoutGroups],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    accessControlService = AccessControlService.getInstance();
    (config.loadSettings as jest.Mock).mockReturnValue(mockSettings);
  });

  describe('canAccessGroup', () => {
    it('should allow admin to access any group', () => {
      expect(accessControlService.canAccessGroup(mockAdminUser, 'group-123')).toBe(true);
      expect(accessControlService.canAccessGroup(mockAdminUser, 'group-456')).toBe(true);
    });

    it('should allow user to access groups in their allowedGroups', () => {
      expect(accessControlService.canAccessGroup(mockRegularUser, 'group-123')).toBe(true);
    });

    it('should deny user access to groups not in their allowedGroups', () => {
      expect(accessControlService.canAccessGroup(mockRegularUser, 'group-456')).toBe(false);
    });

    it('should allow user to access groups they own', () => {
      expect(accessControlService.canAccessGroup(mockRegularUser, 'group-456')).toBe(true); // user1 owns group-456
    });

    it('should deny access to anonymous users', () => {
      expect(accessControlService.canAccessGroup(null, 'group-123')).toBe(false);
    });

    it('should deny access to users without allowedGroups', () => {
      expect(accessControlService.canAccessGroup(mockUserWithoutGroups, 'group-123')).toBe(false);
    });

    it('should deny access to non-existent groups', () => {
      expect(accessControlService.canAccessGroup(mockRegularUser, 'non-existent-group')).toBe(false);
    });

    it('should allow admin to access global routes (undefined group)', () => {
      expect(accessControlService.canAccessGroup(mockAdminUser, undefined)).toBe(true);
    });

    it('should deny regular users access to global routes (undefined group)', () => {
      expect(accessControlService.canAccessGroup(mockRegularUser, undefined)).toBe(false);
    });

    it('should find groups by name as well as ID', () => {
      expect(accessControlService.canAccessGroup(mockAdminUser, 'Production')).toBe(true);
    });
  });

  describe('canAccessGlobalRoute', () => {
    it('should allow admin to access global routes', () => {
      expect(accessControlService.canAccessGlobalRoute(mockAdminUser)).toBe(true);
    });

    it('should deny regular users access to global routes', () => {
      expect(accessControlService.canAccessGlobalRoute(mockRegularUser)).toBe(false);
    });

    it('should deny anonymous users access to global routes', () => {
      expect(accessControlService.canAccessGlobalRoute(null)).toBe(false);
    });
  });

  describe('getUserByUsername', () => {
    it('should return user if found', () => {
      const user = accessControlService.getUserByUsername('admin');
      expect(user).toEqual(mockAdminUser);
    });

    it('should return null if user not found', () => {
      const user = accessControlService.getUserByUsername('nonexistent');
      expect(user).toBeNull();
    });

    it('should handle errors gracefully', () => {
      (config.loadSettings as jest.Mock).mockImplementation(() => {
        throw new Error('Config error');
      });
      const user = accessControlService.getUserByUsername('admin');
      expect(user).toBeNull();
    });
  });

  describe('getUserAccessibleGroups', () => {
    it('should return all groups for admin users', () => {
      const groups = accessControlService.getUserAccessibleGroups(mockAdminUser);
      expect(groups).toEqual(['group-123', 'group-456']);
    });

    it('should return allowed groups and owned groups for regular users', () => {
      const groups = accessControlService.getUserAccessibleGroups(mockRegularUser);
      expect(groups).toContain('group-123'); // allowed group
      expect(groups).toContain('group-456'); // owned group
    });

    it('should return empty array for users without permissions', () => {
      const groups = accessControlService.getUserAccessibleGroups(mockUserWithoutGroups);
      expect(groups).toEqual([]);
    });

    it('should return empty array for anonymous users', () => {
      const groups = accessControlService.getUserAccessibleGroups(null);
      expect(groups).toEqual([]);
    });

    it('should handle config errors gracefully', () => {
      (config.loadSettings as jest.Mock).mockImplementation(() => {
        throw new Error('Config error');
      });
      const groups = accessControlService.getUserAccessibleGroups(mockAdminUser);
      expect(groups).toEqual([]);
    });
  });

  describe('Security Tests', () => {
    it('should prevent privilege escalation via group ownership spoofing', () => {
      const maliciousUser: IUser = {
        username: 'malicious',
        password: 'hashedPassword',
        isAdmin: false,
      };

      // Attempt to access a group they don't own or have permission for
      expect(accessControlService.canAccessGroup(maliciousUser, 'group-123')).toBe(false);
      expect(accessControlService.canAccessGroup(maliciousUser, 'group-456')).toBe(false);
    });

    it('should not allow null username to bypass authentication', () => {
      expect(accessControlService.canAccessGroup(null, 'group-123')).toBe(false);
      expect(accessControlService.canAccessGlobalRoute(null)).toBe(false);
    });

    it('should not allow undefined isAdmin to be treated as admin', () => {
      const userWithoutAdminFlag: IUser = {
        username: 'testuser',
        password: 'hashedPassword',
        // isAdmin is undefined
      };

      expect(accessControlService.canAccessGlobalRoute(userWithoutAdminFlag)).toBe(false);
    });

    it('should prevent access to groups via case manipulation', () => {
      // Ensure group lookups are case-sensitive
      expect(accessControlService.canAccessGroup(mockAdminUser, 'GROUP-123')).toBe(false);
      expect(accessControlService.canAccessGroup(mockAdminUser, 'PRODUCTION')).toBe(false);
    });
  });
});
