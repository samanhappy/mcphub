import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ToolPolicyPanel from '../../frontend/src/components/ToolPolicyPanel';
import type { ToolPolicyRule } from '../../src/types/toolPolicy';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const rules: ToolPolicyRule[] = [
  { id: 'deny-delete', effect: 'deny', serverId: 'server-id', tool: 'delete' },
];
const props = {
  rules,
  nameSeparator: '-',
  loading: false,
  loadError: null,
  onRetry: jest.fn(),
  onSave: jest.fn(),
  users: [],
  bearerKeys: [{ id: 'key-id', name: 'Automation', token: 'secret-do-not-render' }] as never,
  servers: [
    { name: 'demo', config: { id: 'server-id' }, tools: [{ name: 'demo-demo-delete' }] },
  ] as never,
  groups: [],
};

function openPanel(draft: ToolPolicyRule[] | null = null) {
  const setters = Array.from({ length: 5 }, () => jest.fn());
  const values = [true, draft, '', false, false];
  let index = 0;
  jest.spyOn(React, 'useState').mockImplementation(() => {
    const i = index++ % values.length;
    return [values[i], setters[i]] as never;
  });
  return setters;
}

function elements(node: unknown): React.ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children)];
}

afterEach(() => jest.restoreAllMocks());

test('offers persistent IDs and canonical tool names without exposing bearer tokens', () => {
  openPanel();
  const html = renderToStaticMarkup(createElement(ToolPolicyPanel, props));
  expect(html).toContain('value="server-id"');
  expect(html).toContain('value="demo-delete"');
  expect(html).not.toContain('value="demo-demo-delete"');
  expect(html).toContain('Automation');
  expect(html).not.toContain('secret-do-not-render');
});

test('a failed initial load offers retry without allowing replacement with empty policies', () => {
  openPanel();
  const html = renderToStaticMarkup(
    createElement(ToolPolicyPanel, { ...props, rules: undefined, loadError: 'Failed to load' }),
  );
  expect(html).toContain('Failed to load');
  expect(html).toContain('settings.toolPolicies.retry');
  expect(html).not.toContain('settings.toolPolicies.add');
  expect(html).not.toContain('settings.toolPolicies.save</button>');
});

test('validates duplicate rule IDs before opening save confirmation', () => {
  const setters = openPanel([rules[0], { ...rules[0], tool: 'read' }]);
  const tree = ToolPolicyPanel(props);
  const save = elements(tree).find(
    (node) => node.type === 'button' && node.props.children === 'settings.toolPolicies.save',
  )!;
  (save.props.onClick as () => void)();
  expect(setters[2]).toHaveBeenCalledWith('settings.toolPolicies.invalid');
  expect(setters[3]).not.toHaveBeenCalled();
  expect(props.onSave).not.toHaveBeenCalled();
});

test('deleting the last rule stays a draft and requires clear-all confirmation', () => {
  const setters = openPanel();
  const tree = ToolPolicyPanel(props);
  const remove = elements(tree).find(
    (node) =>
      node.type === 'button' && node.props['aria-label'] === 'settings.toolPolicies.deleteRule',
  )!;
  (remove.props.onClick as () => void)();
  expect(setters[1]).toHaveBeenCalledWith([]);
  expect(props.onSave).not.toHaveBeenCalled();
  jest.restoreAllMocks();
  openPanel([]);
  const confirmation = elements(ToolPolicyPanel(props)).find(
    (node) => node.props.message === 'settings.toolPolicies.confirmClear',
  );
  expect(confirmation).toBeDefined();
});

test.each([true, false])(
  'save result=%s retains drafts on failure and clears them on success',
  async (success) => {
    const draft: ToolPolicyRule[] = [
      { id: 'allow-read', effect: 'allow', username: 'alice', tool: 'read' },
    ];
    const setters = openPanel(draft);
    const onSave = jest.fn().mockResolvedValue(success);
    const dialog = elements(ToolPolicyPanel({ ...props, onSave })).find(
      (node) => typeof node.props.onConfirm === 'function',
    )!;
    await (dialog.props.onConfirm as () => Promise<void>)();
    expect(onSave).toHaveBeenCalledWith(draft);
    if (success) expect(setters[1]).toHaveBeenCalledWith(null);
    else {
      expect(setters[1]).not.toHaveBeenCalled();
      expect(setters[2]).toHaveBeenCalledWith('settings.toolPolicies.saveFailed');
    }
  },
);

test('new rules require an explicit ID before they can be saved', () => {
  const setters = openPanel();
  const add = elements(ToolPolicyPanel(props)).find(
    (node) =>
      node.type === 'button' &&
      Array.isArray(node.props.children) &&
      node.props.children.includes('settings.toolPolicies.add'),
  )!;
  (add.props.onClick as () => void)();
  expect(setters[1]).toHaveBeenCalledWith([...rules, { id: '', effect: 'deny' }]);
});

test('clearing a selector omits it while preserving other exact selectors', () => {
  const setters = openPanel();
  const input = elements(ToolPolicyPanel(props)).find(
    (node) => node.type === 'input' && node.props.list === 'policy-0-serverId',
  )!;
  (input.props.onChange as (event: unknown) => void)({ target: { value: '' } });
  expect(setters[1]).toHaveBeenCalledWith([{ id: 'deny-delete', effect: 'deny', tool: 'delete' }]);
});

test('blocks edits while an API operation is in flight', () => {
  openPanel();
  const tree = ToolPolicyPanel({ ...props, loading: true });
  const editor = elements(tree).find(
    (node) => node.type === 'fieldset' && node.props.disabled === true,
  );
  expect(editor).toBeDefined();
});
