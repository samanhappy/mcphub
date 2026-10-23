export interface SelectableCapability {
  value: string;
  description?: string;
  annotations?: Record<string, unknown>;
}
export type SelectionAction = 'select' | 'deselect' | 'invert';
export type AnnotationFilter = 'all' | 'readOnlyHint' | 'destructiveHint' | 'idempotentHint';
export type RiskGroup = 'read' | 'create' | 'update' | 'delete' | 'other';
export const RISK_GROUPS: RiskGroup[] = ['read', 'create', 'update', 'delete', 'other'];
export const classifyTool = (item: SelectableCapability): RiskGroup => {
  if (item.annotations?.readOnlyHint === true) return 'read';
  const name = item.value.toLowerCase();
  if (/^(delete|remove)[_-]/.test(name)) return 'delete';
  // A destructive hint does not distinguish create/update/delete.
  if (item.annotations?.destructiveHint === true) return 'other';
  if (/^(create|add)[_-]/.test(name)) return 'create';
  if (/^(update|set)[_-]/.test(name)) return 'update';
  if (item.annotations?.readOnlyHint !== false && /^(get|list|read|search)[_-]/.test(name))
    return 'read';
  return 'other';
};

export const filterCapabilities = <T extends SelectableCapability>(
  items: T[],
  query: string,
  annotation: AnnotationFilter,
): T[] => {
  const search = query.trim().toLowerCase();
  return items.filter(
    (item) =>
      (item.value.toLowerCase().includes(search) ||
        item.description?.toLowerCase().includes(search)) &&
      (annotation === 'all' || item.annotations?.[annotation] === true),
  );
};

export const applyVisibleSelection = (
  selection: string[] | 'all',
  all: string[],
  visible: string[],
  action: SelectionAction,
): string[] | 'all' => {
  if (visible.length === 0 || (selection === 'all' && action === 'select')) return selection;
  const selected = new Set(selection === 'all' ? all : selection);
  for (const name of visible) {
    if (action === 'deselect' || (action === 'invert' && selected.has(name))) selected.delete(name);
    else selected.add(name);
  }
  // An explicit snapshot stays explicit, including when every current item is selected.
  return [...selected];
};
