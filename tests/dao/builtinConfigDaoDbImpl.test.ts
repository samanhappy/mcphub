const mockPromptRepository = {
  findAll: jest.fn(),
  findEnabled: jest.fn(),
  findById: jest.fn(),
  findByName: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};

const mockResourceRepository = {
  findAll: jest.fn(),
  findEnabled: jest.fn(),
  findById: jest.fn(),
  findByUri: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};

jest.mock('../../src/db/repositories/BuiltinPromptRepository.js', () => ({
  BuiltinPromptRepository: jest.fn().mockImplementation(() => mockPromptRepository),
}));

jest.mock('../../src/db/repositories/BuiltinResourceRepository.js', () => ({
  BuiltinResourceRepository: jest.fn().mockImplementation(() => mockResourceRepository),
}));

import { BuiltinPromptDaoDbImpl } from '../../src/dao/BuiltinPromptDaoDbImpl.js';
import { BuiltinResourceDaoDbImpl } from '../../src/dao/BuiltinResourceDaoDbImpl.js';

describe('BuiltinPromptDaoDbImpl', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should create prompt in database repository', async () => {
    const dao = new BuiltinPromptDaoDbImpl();
    mockPromptRepository.findByName.mockResolvedValue(null);
    mockPromptRepository.create.mockResolvedValue({
      id: 'prompt-1',
      name: 'summarize',
      title: 'Summarize',
      description: 'Summarize text',
      template: 'Please summarize: {{text}}',
      arguments: [{ name: 'text', required: true }],
      enabled: true,
    });

    const created = await dao.create({
      name: 'summarize',
      title: 'Summarize',
      description: 'Summarize text',
      template: 'Please summarize: {{text}}',
      arguments: [{ name: 'text', required: true }],
      enabled: true,
    });

    expect(mockPromptRepository.findByName).toHaveBeenCalledWith('summarize');
    expect(mockPromptRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'summarize',
        template: 'Please summarize: {{text}}',
        enabled: true,
      }),
    );
    expect(created.id).toBe('prompt-1');
  });

  it('should reject duplicate prompt name', async () => {
    const dao = new BuiltinPromptDaoDbImpl();
    mockPromptRepository.findByName.mockResolvedValue({ id: 'existing', name: 'summarize' });

    await expect(
      dao.create({
        name: 'summarize',
        template: 'x',
      }),
    ).rejects.toThrow("Builtin prompt with name 'summarize' already exists");
  });
});

describe('BuiltinResourceDaoDbImpl', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should create resource in database repository', async () => {
    const dao = new BuiltinResourceDaoDbImpl();
    mockResourceRepository.findByUri.mockResolvedValue(null);
    mockResourceRepository.create.mockResolvedValue({
      id: 'resource-1',
      uri: 'resource://docs/intro',
      name: 'Intro',
      description: 'Introduction',
      mimeType: 'text/plain',
      content: 'hello',
      enabled: true,
    });

    const created = await dao.create({
      uri: 'resource://docs/intro',
      name: 'Intro',
      description: 'Introduction',
      mimeType: 'text/plain',
      content: 'hello',
      enabled: true,
    });

    expect(mockResourceRepository.findByUri).toHaveBeenCalledWith('resource://docs/intro');
    expect(mockResourceRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        uri: 'resource://docs/intro',
        content: 'hello',
        enabled: true,
      }),
    );
    expect(created.id).toBe('resource-1');
  });

  it('should reject duplicate resource uri', async () => {
    const dao = new BuiltinResourceDaoDbImpl();
    mockResourceRepository.findByUri.mockResolvedValue({
      id: 'existing',
      uri: 'resource://docs/intro',
    });

    await expect(
      dao.create({
        uri: 'resource://docs/intro',
        content: 'hello',
      }),
    ).rejects.toThrow("Builtin resource with URI 'resource://docs/intro' already exists");
  });
});
