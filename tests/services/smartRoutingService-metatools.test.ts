// Mock all transitive dependencies before importing smartRoutingService
jest.mock('../../src/services/groupService.js', () => ({
  getServersInGroup: jest.fn(),
  getServerConfigInGroup: jest.fn(),
}));

jest.mock('../../src/services/vectorSearchService.js', () => ({
  searchToolsByVector: jest.fn(),
  saveToolsAsVectorEmbeddings: jest.fn(),
}));

jest.mock('../../src/utils/smartRouting.js', () => ({
  getSmartRoutingConfig: jest.fn(() => Promise.resolve({ progressiveDisclosure: false })),
}));

jest.mock('../../src/dao/index.js', () => ({
  getServerDao: jest.fn(() => ({
    findById: jest.fn(),
    findAll: jest.fn(() => Promise.resolve([])),
  })),
}));

jest.mock('../../src/services/sseService.js', () => ({
  getGroup: jest.fn(),
}));

import { buildSmartRoutingMetaTools } from '../../src/services/smartRoutingService.js';

describe('buildSmartRoutingMetaTools', () => {
  it('returns 2 tools (search_tools, call_tool) in standard mode', () => {
    const tools = buildSmartRoutingMetaTools('all available servers', 'srv-a, srv-b', false);
    expect(tools.map((t) => t.name)).toEqual(['search_tools', 'call_tool']);
  });

  it('returns 3 tools (adds describe_tool) under progressive disclosure', () => {
    const tools = buildSmartRoutingMetaTools('all available servers', 'srv-a, srv-b', true);
    expect(tools.map((t) => t.name)).toEqual(['search_tools', 'describe_tool', 'call_tool']);
  });

  it('embeds the scope description and server list into search_tools', () => {
    const tools = buildSmartRoutingMetaTools('servers in the "x" group', 'srv-a', false);
    const search = tools.find((t) => t.name === 'search_tools')!;
    expect(search.description).toContain('servers in the "x" group');
    expect(search.description).toContain('srv-a');
  });
});
