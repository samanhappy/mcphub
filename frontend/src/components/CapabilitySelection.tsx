import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AnnotationFilter,
  applyVisibleSelection,
  classifyTool,
  filterCapabilities,
  RISK_GROUPS,
  SelectableCapability,
  SelectionAction,
} from '@/utils/capabilitySelection';

interface Props<T extends SelectableCapability> {
  items: T[];
  selection: string[] | 'all';
  tools: boolean;
  label: string;
  onChange: (selection: string[] | 'all') => void;
  children: (item: T) => React.ReactNode;
}

export const CapabilitySelection = <T extends SelectableCapability>({
  items,
  selection,
  tools,
  label,
  onChange,
  children,
}: Props<T>) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [annotation, setAnnotation] = useState<AnnotationFilter>('all');
  const [grouped, setGrouped] = useState(false);
  const visible = filterCapabilities(items, query, annotation);
  const selected = new Set(selection === 'all' ? items.map((item) => item.value) : selection);
  const apply = (target: T[], action: SelectionAction) =>
    onChange(
      applyVisibleSelection(
        selection,
        items.map((item) => item.value),
        target.map((item) => item.value),
        action,
      ),
    );
  const sections =
    tools && grouped
      ? RISK_GROUPS.map((risk) => ({
          risk,
          items: visible.filter((item) => classifyTool(item) === risk),
        }))
      : [{ risk: null, items: visible }];
  const buttonClass =
    'text-xs text-blue-600 hover:text-blue-800 disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <section aria-label={label}>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <input
          type="search"
          aria-label={t('groups.bulkSearchLabel', { capability: label })}
          placeholder={t('groups.bulkSearch')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="min-w-0 flex-1 basis-48 rounded border border-gray-300 bg-white dark:bg-gray-800 px-2 py-1 text-sm"
        />
        {tools && (
          <>
            <select
              aria-label={t('groups.annotationFilter')}
              value={annotation}
              onChange={(event) => setAnnotation(event.target.value as AnnotationFilter)}
              className="max-w-full rounded border border-gray-300 bg-white dark:bg-gray-800 px-2 py-1 text-sm"
            >
              <option value="all">{t('groups.allAnnotations')}</option>
              {(['readOnlyHint', 'destructiveHint', 'idempotentHint'] as const).map((hint) => (
                <option key={hint} value={hint}>
                  {t(`groups.${hint}`)}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-pressed={grouped}
              onClick={() => setGrouped(!grouped)}
              className={buttonClass}
            >
              {t(grouped ? 'groups.flatList' : 'groups.riskGroups')}
            </button>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2">
        <span className="text-xs text-gray-500" role="status">
          {t('groups.visibleCount', { count: visible.length, total: items.length })}
        </span>
        {(['select', 'deselect', 'invert'] as const).map((action) => (
          <button
            key={action}
            type="button"
            disabled={!visible.length}
            onClick={() => apply(visible, action)}
            className={buttonClass}
          >
            {t(`groups.${action}Visible`)}
          </button>
        ))}
      </div>
      {tools && grouped && <p className="text-xs text-gray-500 mb-2">{t('groups.riskHint')}</p>}
      <div className="grid grid-cols-1 gap-2 max-h-96 overflow-y-auto">
        {visible.length === 0 && (
          <p className="text-sm text-gray-500">{t('groups.noMatchingItems')}</p>
        )}
        {sections
          .filter((section) => section.items.length > 0)
          .map((section) => {
            const count = section.items.filter((item) => selected.has(item.value)).length;
            return (
              <React.Fragment key={section.risk ?? 'flat'}>
                {section.risk && (
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 py-1">
                    <span className="text-xs font-medium">
                      {t(`groups.risk_${section.risk}`)} ({count}/{section.items.length})
                    </span>
                    <button
                      type="button"
                      className={buttonClass}
                      onClick={() =>
                        apply(section.items, count === section.items.length ? 'deselect' : 'select')
                      }
                    >
                      {t(count === section.items.length ? 'groups.selectNone' : 'groups.selectAll')}
                    </button>
                  </div>
                )}
                {section.items.map((item) => (
                  <React.Fragment key={item.value}>{children(item)}</React.Fragment>
                ))}
              </React.Fragment>
            );
          })}
      </div>
    </section>
  );
};
