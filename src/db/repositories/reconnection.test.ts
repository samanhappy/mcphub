const mockGetRepository = jest.fn();
jest.mock('../connection.js', () => ({
  getAppDataSource: () => ({ getRepository: mockGetRepository }),
}));

import { ActivityRepository } from './ActivityRepository.js';
import { BearerKeyRepository } from './BearerKeyRepository.js';
import { BuiltinPromptRepository } from './BuiltinPromptRepository.js';
import { BuiltinResourceRepository } from './BuiltinResourceRepository.js';
import { GroupRepository } from './GroupRepository.js';
import { OAuthClientRepository } from './OAuthClientRepository.js';
import { OAuthTokenRepository } from './OAuthTokenRepository.js';
import { ServerRepository } from './ServerRepository.js';
import { UserConfigRepository } from './UserConfigRepository.js';
import { UserRepository } from './UserRepository.js';
import { BaseRepository } from './BaseRepository.js';

describe('repositories after DataSource replacement', () => {
  it.each([
    [
      'Activity',
      () => {
        const repo = new ActivityRepository();
        return () => repo.findById('id');
      },
    ],
    [
      'BearerKey',
      () => {
        const repo = new BearerKeyRepository();
        return () => repo.findAll();
      },
    ],
    [
      'BuiltinPrompt',
      () => {
        const repo = new BuiltinPromptRepository();
        return () => repo.findAll();
      },
    ],
    [
      'BuiltinResource',
      () => {
        const repo = new BuiltinResourceRepository();
        return () => repo.findAll();
      },
    ],
    [
      'Group',
      () => {
        const repo = new GroupRepository();
        return () => repo.findAll();
      },
    ],
    [
      'OAuthClient',
      () => {
        const repo = new OAuthClientRepository();
        return () => repo.findAll();
      },
    ],
    [
      'OAuthToken',
      () => {
        const repo = new OAuthTokenRepository();
        return () => repo.findAll();
      },
    ],
    [
      'Server',
      () => {
        const repo = new ServerRepository();
        return () => repo.findAll();
      },
    ],
    [
      'UserConfig',
      () => {
        const repo = new UserConfigRepository();
        return () => repo.get('user');
      },
    ],
    [
      'User',
      () => {
        const repo = new UserRepository();
        return () => repo.findAll();
      },
    ],
    [
      'Base',
      () => {
        const repo = new BaseRepository('entity');
        return () => repo.findAll();
      },
    ],
  ])('%s uses the replacement connection', async (_name, createOperation) => {
    const oldRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
    };
    const newRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
    };
    mockGetRepository.mockReturnValue(oldRepository);
    const operation = createOperation();
    await operation();
    oldRepository.find.mockClear();
    oldRepository.findOne.mockClear();
    mockGetRepository.mockReturnValue(newRepository);
    await operation();
    expect(oldRepository.find).not.toHaveBeenCalled();
    expect(oldRepository.findOne).not.toHaveBeenCalled();
    expect(newRepository.find.mock.calls.length + newRepository.findOne.mock.calls.length).toBe(1);
  });
});
