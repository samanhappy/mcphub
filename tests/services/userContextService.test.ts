import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { UserContextService } from '../../src/services/userContextService.js';

describe('UserContextService', () => {
  let service: UserContextService;

  beforeEach(() => {
    service = UserContextService.getInstance();
    service.clearCurrentUser();
  });

  afterEach(() => {
    service.clearCurrentUser();
  });

  it('stores and clears the current user', () => {
    service.setCurrentUser({ username: 'alice', password: '', isAdmin: false });

    expect(service.getCurrentUser()).toEqual({
      username: 'alice',
      password: '',
      isAdmin: false,
    });
    expect(service.hasUser()).toBe(true);
    expect(service.isAdmin()).toBe(false);

    service.clearCurrentUser();

    expect(service.getCurrentUser()).toBeNull();
    expect(service.hasUser()).toBe(false);
  });

  it('isolates concurrent async user contexts', async () => {
    const results = await Promise.all([
      (async () => {
        service.setCurrentUser({ username: 'alpha', password: '', isAdmin: false });
        await new Promise((resolve) => setTimeout(resolve, 10));

        return service.getCurrentUser();
      })(),
      (async () => {
        service.setCurrentUser({ username: 'beta', password: '', isAdmin: true });
        await new Promise((resolve) => setTimeout(resolve, 0));

        return service.getCurrentUser();
      })(),
    ]);

    expect(results).toEqual([
      { username: 'alpha', password: '', isAdmin: false },
      { username: 'beta', password: '', isAdmin: true },
    ]);

    service.clearCurrentUser();
    expect(service.getCurrentUser()).toBeNull();
  });
});