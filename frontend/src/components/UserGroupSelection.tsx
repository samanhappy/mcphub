import { useTranslation } from 'react-i18next';

export default function UserGroupSelection({
  options,
  selected,
  disabled,
  onChange,
}: {
  options: string[];
  selected: string[];
  disabled?: boolean;
  onChange: (groups: string[]) => void;
}) {
  const { t } = useTranslation();
  const groups = [...new Set([...options, ...selected])].sort();
  return (
    <fieldset disabled={disabled} className="mb-4">
      <legend className="text-sm font-medium">{t('users.userGroups')}</legend>
      <p className="text-xs text-gray-500 mt-1 mb-2">{t('users.shareUserGroupsHint')}</p>
      {groups.map((group) => (
        <label key={group} className="flex items-center gap-2 py-1 text-sm">
          <input
            type="checkbox"
            checked={selected.includes(group)}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...selected, group]
                  : selected.filter((name) => name !== group),
              )
            }
          />
          {group}
        </label>
      ))}
    </fieldset>
  );
}
