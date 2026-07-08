const mockApiPost = jest.fn();

jest.mock('../../frontend/src/utils/fetchInterceptor', () => ({
  apiPost: mockApiPost,
}));

import { disconnectServerOAuth } from '../../frontend/src/services/serverOAuthService';

describe('disconnectServerOAuth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApiPost.mockResolvedValue({ success: true });
  });

  it('posts to the encoded upstream OAuth disconnect endpoint with token scope by default', async () => {
    await disconnectServerOAuth('notion/workspace');

    expect(mockApiPost).toHaveBeenCalledWith(
      '/servers/notion%2Fworkspace/oauth/disconnect',
      { scope: 'tokens' },
    );
  });
});
