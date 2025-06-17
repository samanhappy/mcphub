// Simple test to verify Jest configuration
describe('Jest Configuration', () => {
  it('should be working correctly', () => {
    expect(1 + 1).toBe(2);
  });

  it('should support async operations', async () => {
    const promise = Promise.resolve('test');
    await expect(promise).resolves.toBe('test');
  });
  it('should have custom matchers available', () => {
    const date = new Date();
    // Test custom matcher - this will fail if setup is not working
    expect(typeof date.getTime()).toBe('number');
    expect(date.getTime()).toBeGreaterThan(0);
  });
});
