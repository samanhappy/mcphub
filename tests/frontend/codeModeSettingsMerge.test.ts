import {
  DEFAULT_SMART_ROUTING_CODE_MODE,
  mergeSmartRoutingConfigUpdate,
  type SmartRoutingConfig,
} from '../../frontend/src/contexts/settingsTypes.js';

const baseConfig: SmartRoutingConfig = {
  enabled: true,
  dbUrl: 'postgres://localhost/mcphub',
  embeddingDimensionsApiPassthrough: false,
  llmProviderBaseUrl: 'https://api.openai.com/v1',
  llmProviderApiKey: 'sk-test',
  embeddingModel: 'text-embedding-3-small',
  progressiveDisclosure: false,
  codeMode: {
    ...DEFAULT_SMART_ROUTING_CODE_MODE,
    enabled: true,
    readOnlyVariantEnabled: true,
    timeoutMs: 45000,
    maxToolCalls: 35,
  },
};

describe('mergeSmartRoutingConfigUpdate', () => {
  it('preserves enabled and custom limits when toggling readOnlyVariantEnabled with a partial codeMode object', () => {
    const updated = mergeSmartRoutingConfigUpdate(baseConfig, {
      codeMode: { readOnlyVariantEnabled: false } as SmartRoutingConfig['codeMode'],
    });

    expect(updated.codeMode).toEqual({
      ...DEFAULT_SMART_ROUTING_CODE_MODE,
      enabled: true,
      readOnlyVariantEnabled: false,
      timeoutMs: 45000,
      maxToolCalls: 35,
    });
  });

  it('preserves readOnlyVariantEnabled and custom limits when toggling enabled with a partial codeMode object', () => {
    const updated = mergeSmartRoutingConfigUpdate(baseConfig, {
      codeMode: { enabled: false } as SmartRoutingConfig['codeMode'],
    });

    expect(updated.codeMode).toEqual({
      ...DEFAULT_SMART_ROUTING_CODE_MODE,
      enabled: false,
      readOnlyVariantEnabled: true,
      timeoutMs: 45000,
      maxToolCalls: 35,
    });
  });

  it('leaves codeMode untouched when updating unrelated smartRouting fields', () => {
    const updated = mergeSmartRoutingConfigUpdate(baseConfig, {
      progressiveDisclosure: true,
    });

    expect(updated.progressiveDisclosure).toBe(true);
    expect(updated.codeMode).toEqual(baseConfig.codeMode);
  });
});
