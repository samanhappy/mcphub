import { applyRewrite, planRewrite } from '../rewrite.js';

const REF = 'mcpfile://11111111-1111-4111-8111-111111111111';
const OTHER = 'mcpfile://22222222-2222-4222-8222-222222222222';

describe('staging argument rewrite', () => {
  it('splits declared input and output refs', () => {
    expect(
      planRewrite(
        { localPath: REF, remotePath: '/tmp/a.txt' },
        ['localPath'],
        ['remotePath'],
      ),
    ).toEqual({ inputRefs: [REF], outputRefs: [] });
  });

  it('supports nested parameter paths', () => {
    expect(
      planRewrite({ options: { file: REF } }, ['options.file'], []),
    ).toEqual({ inputRefs: [REF], outputRefs: [] });
  });

  it('rejects an undeclared ref instead of forwarding it', () => {
    expect(() => planRewrite({ other: REF }, ['localPath'], [])).toThrow(/not allowed/i);
    expect(() => planRewrite({ localPath: REF }, [], [])).toThrow(/not allowed/i);
  });

  it('rejects the same ref twice and leaves directionless refs alone', () => {
    expect(() => planRewrite({ localPath: REF, backup: REF }, ['localPath', 'backup'], [])).toThrow(
      /twice/i,
    );
    expect(planRewrite({ note: 'hello' }, ['localPath'], [])).toEqual({
      inputRefs: [],
      outputRefs: [],
    });
  });

  it('rewrites exact values only, recursively', () => {
    const rewritten = applyRewrite(
      { localPath: REF, list: [REF, '/keep'], nested: { file: REF, text: `prefix ${REF}` } },
      new Map([[REF, '/srv/staging/content']]),
    );
    expect(rewritten).toEqual({
      localPath: '/srv/staging/content',
      list: ['/srv/staging/content', '/keep'],
      nested: { file: '/srv/staging/content', text: `prefix ${REF}` },
    });
  });

  it('does not touch another ref with a different mapping', () => {
    const rewritten = applyRewrite({ a: REF, b: OTHER }, new Map([[REF, '/x']]));
    expect(rewritten).toEqual({ a: '/x', b: OTHER });
  });
});
