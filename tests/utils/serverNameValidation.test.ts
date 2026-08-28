import {
  validateServerName,
  slugifyServerName,
  SERVER_NAME_PATTERN,
  SERVER_NAME_MAX_LENGTH,
} from '../../src/utils/serverNameValidation.js';

describe('validateServerName', () => {
  it('accepts charset-safe names', () => {
    expect(validateServerName('weather-server')).toEqual({
      valid: true,
      normalized: 'weather-server',
    });
    expect(validateServerName('io.github.user-weather')).toEqual({
      valid: true,
      normalized: 'io.github.user-weather',
    });
    expect(validateServerName('foo_1.BAR')).toEqual({
      valid: true,
      normalized: 'foo_1.BAR',
    });
  });

  it('trims surrounding whitespace', () => {
    expect(validateServerName('  weather-server  ')).toEqual({
      valid: true,
      normalized: 'weather-server',
    });
  });

  it('rejects empty / non-string / whitespace-only names', () => {
    expect(validateServerName(undefined).valid).toBe(false);
    expect(validateServerName(null).valid).toBe(false);
    expect(validateServerName('').valid).toBe(false);
    expect(validateServerName('   ').valid).toBe(false);
    expect(validateServerName(12345).valid).toBe(false);
  });

  it('rejects names with spaces', () => {
    const result = validateServerName('my server');
    expect(result.valid).toBe(false);
    expect(result.message).toContain('only contain letters');
  });

  it('rejects CJK / non-ASCII names', () => {
    expect(validateServerName('我的伺服器').valid).toBe(false);
    expect(validateServerName('héllo').valid).toBe(false);
  });

  it('rejects names containing the path separator', () => {
    expect(validateServerName('io.github.user/weather').valid).toBe(false);
    expect(validateServerName('a\\b').valid).toBe(false);
  });

  it('rejects consecutive dots', () => {
    const result = validateServerName('a..b');
    expect(result.valid).toBe(false);
    expect(result.message).toContain('consecutive dots');
  });

  it('rejects names longer than the max length', () => {
    const longName = 'a'.repeat(SERVER_NAME_MAX_LENGTH + 1);
    const result = validateServerName(longName);
    expect(result.valid).toBe(false);
    expect(result.message).toContain(`${SERVER_NAME_MAX_LENGTH} characters`);
  });

  it('accepts a name at exactly the max length', () => {
    expect(validateServerName('a'.repeat(SERVER_NAME_MAX_LENGTH)).valid).toBe(true);
  });
});

describe('SERVER_NAME_PATTERN', () => {
  it('matches the documented charset', () => {
    for (const c of 'abcXYZ0123._-') {
      expect(SERVER_NAME_PATTERN.test(c)).toBe(true);
    }
    for (const c of ' /\\,é中文!@#') {
      expect(SERVER_NAME_PATTERN.test(c)).toBe(false);
    }
  });
});

describe('slugifyServerName', () => {
  it('turns a reverse-DNS registry name into a charset-safe name', () => {
    expect(slugifyServerName('io.github.user/weather')).toBe('io.github.user-weather');
  });

  it('replaces other unsafe characters with hyphens', () => {
    expect(slugifyServerName('My Server 中文')).toBe('My-Server');
    expect(slugifyServerName('a b/c')).toBe('a-b-c');
  });

  it('collapses consecutive dots and trims leading/trailing hyphens', () => {
    expect(slugifyServerName('--foo..bar--')).toBe('foo.bar');
  });

  it('caps the result length', () => {
    const result = slugifyServerName('x'.repeat(SERVER_NAME_MAX_LENGTH + 50));
    expect(result.length).toBe(SERVER_NAME_MAX_LENGTH);
  });

  it('falls back to "server" for an empty result', () => {
    expect(slugifyServerName('///')).toBe('server');
  });
});
