const mockServerDao = {
  findAll: jest.fn(),
  findById: jest.fn(),
};

const mockGroupDao = {
  findAll: jest.fn(),
  findById: jest.fn(),
  findByName: jest.fn(),
};

const mockCreateGroup = jest.fn();
const mockAddServer = jest.fn();

jest.mock('../../src/dao/index.js', () => ({
  getServerDao: jest.fn(() => mockServerDao),
  getGroupDao: jest.fn(() => mockGroupDao),
}));

jest.mock('../../src/services/groupService.js', () => ({
  createGroup: (...args: any[]) => mockCreateGroup(...args),
}));

jest.mock('../../src/services/mcpService.js', () => ({
  addServer: (...args: any[]) => mockAddServer(...args),
}));

import { exportTemplate, exportGroupTemplate, importTemplate } from '../../src/services/templateService.js';

describe('templateService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('exportTemplate', () => {
    it('should export all groups and their servers', async () => {
      mockServerDao.findAll.mockResolvedValue([
        { name: 'server1', command: 'npx', args: ['-y', 'mcp-server'], env: { API_KEY: 'secret123' } },
        { name: 'server2', type: 'sse', url: 'http://localhost:3001' },
      ]);
      mockGroupDao.findAll.mockResolvedValue([
        { id: 'g1', name: 'Group A', description: 'Test group', servers: [{ name: 'server1', tools: 'all' }, { name: 'server2', tools: ['tool1'] }] },
      ]);

      const template = await exportTemplate({ name: 'My Template' });

      expect(template.version).toBe('1.0');
      expect(template.name).toBe('My Template');
      expect(template.groups).toHaveLength(1);
      expect(template.groups[0].name).toBe('Group A');
      expect(template.servers['server1']).toBeDefined();
      expect(template.servers['server2']).toBeDefined();
      // Secret should be stripped
      expect(template.servers['server1'].env?.API_KEY).toBe('${API_KEY}');
      expect(template.requiredEnvVars).toContain('API_KEY');
    });

    it('should filter by specific group IDs', async () => {
      mockServerDao.findAll.mockResolvedValue([
        { name: 'server1', command: 'npx' },
        { name: 'server2', command: 'node' },
      ]);
      mockGroupDao.findAll.mockResolvedValue([
        { id: 'g1', name: 'Group A', servers: [{ name: 'server1', tools: 'all' }] },
        { id: 'g2', name: 'Group B', servers: [{ name: 'server2', tools: 'all' }] },
      ]);

      const template = await exportTemplate({ name: 'Test', groupIds: ['g1'] });

      expect(template.groups).toHaveLength(1);
      expect(template.groups[0].name).toBe('Group A');
      expect(template.servers['server1']).toBeDefined();
      expect(template.servers['server2']).toBeUndefined();
    });

    it('should skip disabled servers when includeDisabledServers is false', async () => {
      mockServerDao.findAll.mockResolvedValue([
        { name: 'active', command: 'npx', enabled: true },
        { name: 'disabled', command: 'node', enabled: false },
      ]);
      mockGroupDao.findAll.mockResolvedValue([
        { id: 'g1', name: 'Group', servers: [{ name: 'active', tools: 'all' }, { name: 'disabled', tools: 'all' }] },
      ]);

      const template = await exportTemplate({ name: 'Test', includeDisabledServers: false });

      expect(template.servers['active']).toBeDefined();
      expect(template.servers['disabled']).toBeUndefined();
    });

    it('should preserve existing ${PLACEHOLDER} patterns', async () => {
      mockServerDao.findAll.mockResolvedValue([
        { name: 's1', command: 'npx', env: { TOKEN: '${MY_TOKEN}', REGION: 'us-east-1' } },
      ]);
      mockGroupDao.findAll.mockResolvedValue([
        { id: 'g1', name: 'G', servers: ['s1'] },
      ]);

      const template = await exportTemplate({ name: 'Test' });

      expect(template.servers['s1'].env?.TOKEN).toBe('${MY_TOKEN}');
      expect(template.servers['s1'].env?.REGION).toBe('us-east-1');
      expect(template.requiredEnvVars).toContain('MY_TOKEN');
    });

    it('should strip Authorization headers', async () => {
      mockServerDao.findAll.mockResolvedValue([
        { name: 's1', type: 'sse', url: 'http://example.com', headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' } },
      ]);
      mockGroupDao.findAll.mockResolvedValue([
        { id: 'g1', name: 'G', servers: [{ name: 's1', tools: 'all' }] },
      ]);

      const template = await exportTemplate({ name: 'Test' });

      expect(template.servers['s1'].headers?.Authorization).toBe('${AUTHORIZATION}');
      expect(template.servers['s1'].headers?.['Content-Type']).toBe('application/json');
      expect(template.requiredEnvVars).toContain('AUTHORIZATION');
    });
  });

  describe('exportGroupTemplate', () => {
    it('should export a single group by ID', async () => {
      mockGroupDao.findById.mockResolvedValue({
        id: 'g1', name: 'My Group', description: 'A group', servers: [{ name: 'server1', tools: 'all' }],
      });
      mockServerDao.findAll.mockResolvedValue([
        { name: 'server1', command: 'npx' },
      ]);
      mockGroupDao.findAll.mockResolvedValue([
        { id: 'g1', name: 'My Group', description: 'A group', servers: [{ name: 'server1', tools: 'all' }] },
      ]);

      const template = await exportGroupTemplate('g1');

      expect(template).not.toBeNull();
      expect(template!.name).toBe('My Group Template');
      expect(template!.groups).toHaveLength(1);
    });

    it('should return null for non-existent group', async () => {
      mockGroupDao.findById.mockResolvedValue(null);

      const template = await exportGroupTemplate('nonexistent');

      expect(template).toBeNull();
    });
  });

  describe('importTemplate', () => {
    it('should create servers and groups from a valid template', async () => {
      mockServerDao.findAll.mockResolvedValue([]);
      mockGroupDao.findByName.mockResolvedValue(null);
      mockAddServer.mockResolvedValue(undefined);
      mockCreateGroup.mockResolvedValue({ id: 'new-g1', name: 'Group A' });

      const template = {
        version: '1.0',
        name: 'Test Template',
        createdAt: new Date().toISOString(),
        servers: {
          server1: { command: 'npx', args: ['-y', 'mcp-server'] },
        },
        groups: [
          { name: 'Group A', servers: [{ name: 'server1', tools: 'all' }] },
        ],
        requiredEnvVars: [],
      };

      const result = await importTemplate(template, 'admin');

      expect(result.success).toBe(true);
      expect(result.serversCreated).toBe(1);
      expect(result.groupsCreated).toBe(1);
      expect(mockAddServer).toHaveBeenCalledWith('server1', expect.objectContaining({ command: 'npx' }));
      expect(mockCreateGroup).toHaveBeenCalledWith('Group A', undefined, [{ name: 'server1', tools: 'all' }], 'admin');
    });

    it('should skip existing servers and groups', async () => {
      mockServerDao.findAll.mockResolvedValue([{ name: 'server1', command: 'npx' }]);
      mockGroupDao.findByName.mockResolvedValue({ id: 'existing', name: 'Group A' });

      const template = {
        version: '1.0',
        name: 'Test',
        createdAt: new Date().toISOString(),
        servers: { server1: { command: 'npx' } },
        groups: [{ name: 'Group A', servers: [{ name: 'server1', tools: 'all' }] }],
        requiredEnvVars: [],
      };

      const result = await importTemplate(template, 'admin');

      expect(result.success).toBe(false); // Nothing new created
      expect(result.serversSkipped).toBe(1);
      expect(result.groupsSkipped).toBe(1);
      expect(mockAddServer).not.toHaveBeenCalled();
      expect(mockCreateGroup).not.toHaveBeenCalled();
    });

    it('should reject invalid template format', async () => {
      const result = await importTemplate({ invalid: true }, 'admin');

      expect(result.success).toBe(false);
      expect(result.details[0].action).toBe('failed');
      expect(result.details[0].message).toContain('Invalid template format');
    });

    it('should report requiredEnvVars from template', async () => {
      mockServerDao.findAll.mockResolvedValue([]);
      mockGroupDao.findByName.mockResolvedValue(null);
      mockAddServer.mockResolvedValue(undefined);
      mockCreateGroup.mockResolvedValue({ id: 'g1', name: 'G' });

      const template = {
        version: '1.0',
        name: 'T',
        createdAt: new Date().toISOString(),
        servers: { s1: { command: 'npx', env: { API_KEY: '${API_KEY}' } } },
        groups: [{ name: 'G', servers: [{ name: 's1', tools: 'all' }] }],
        requiredEnvVars: ['API_KEY'],
      };

      const result = await importTemplate(template, 'admin');

      expect(result.requiredEnvVars).toContain('API_KEY');
    });
  });
});
