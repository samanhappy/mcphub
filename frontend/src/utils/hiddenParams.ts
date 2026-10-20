/**
 * The hidden-parameter list to save after one checkbox changes. Only current,
 * optional parameters are sent: a required or since-removed name (possible in a
 * hand-written settings file) would make the server reject the whole list.
 */
export const nextHiddenParams = (
  hidden: string[],
  param: string,
  visible: boolean,
  properties: string[],
  required: string[],
): string[] =>
  (visible ? hidden.filter((name) => name !== param) : [...hidden, param]).filter(
    (name) => properties.includes(name) && !required.includes(name),
  );
