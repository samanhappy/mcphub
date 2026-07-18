import { TypeORMError } from 'typeorm';
import { isRetryableDbError } from './dbRetry.js';

describe('isRetryableDbError', () => {
  it('treats a disconnected TypeORM driver as retryable', () => {
    expect(isRetryableDbError(new TypeORMError('Driver not Connected'))).toBe(true);
  });
});
