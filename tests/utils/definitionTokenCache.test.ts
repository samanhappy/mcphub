const encode = jest.fn((text: string) => [text.length]);
jest.mock('gpt-tokenizer', () => ({ encode: (text: string) => encode(text) }));

import { countDefinitionTokens, itemCostForTool } from '../../src/utils/tokenCost.js';

describe('definition token cache', () => {
  it('shares concurrent counts and reuses settled counts', async () => {
    encode.mockClear();
    await Promise.all([countDefinitionTokens('concurrent'), countDefinitionTokens('concurrent')]);
    await countDefinitionTokens('concurrent');
    expect(encode).toHaveBeenCalledTimes(1);
  });

  it('recounts changed definitions but reads enabled state live', async () => {
    encode.mockClear();
    const tool = { name: 'changed', inputSchema: {}, enabled: true };
    await itemCostForTool(tool);
    expect((await itemCostForTool({ ...tool, enabled: false })).enabled).toBe(false);
    await itemCostForTool({ ...tool, inputSchema: { type: 'object' } });
    expect(encode).toHaveBeenCalledTimes(2);
  });

  it('evicts old entries when the capacity is exceeded', async () => {
    await countDefinitionTokens('oldest');
    for (let i = 0; i < 10000; i++) await countDefinitionTokens(`eviction-${i}`);
    encode.mockClear();
    await countDefinitionTokens('oldest');
    expect(encode).toHaveBeenCalledTimes(1);
  });

  it('allows failed counts to be retried', async () => {
    encode.mockImplementationOnce(() => {
      throw new Error('encode failure');
    });
    await expect(countDefinitionTokens('retry')).rejects.toThrow('encode failure');
    await expect(countDefinitionTokens('retry')).resolves.toBe(1);
  });
});
