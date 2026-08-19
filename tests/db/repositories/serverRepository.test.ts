const queryBuilder = {
  where: jest.fn().mockReturnThis(),
  orWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  addOrderBy: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
};

const repository = {
  createQueryBuilder: jest.fn(() => queryBuilder),
};

jest.mock('../../../src/db/connection.js', () => ({
  getAppDataSource: jest.fn(() => ({
    getRepository: jest.fn(() => repository),
  })),
}));

import { ServerRepository } from '../../../src/db/repositories/ServerRepository.js';

describe('ServerRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    queryBuilder.getManyAndCount.mockResolvedValue([[], 0]);
  });

  it('includes explicit shared-user membership before pagination', async () => {
    const serverRepository = new ServerRepository();

    await serverRepository.findVisibleToUserPaginated('alice', 2, 10);

    expect(queryBuilder.orWhere).toHaveBeenCalledWith(expect.stringContaining('sharedWithUsers'), {
      sharedVisibility: 'group',
      username: 'alice',
    });
    expect(queryBuilder.skip).toHaveBeenCalledWith(10);
    expect(queryBuilder.take).toHaveBeenCalledWith(10);
  });
});
