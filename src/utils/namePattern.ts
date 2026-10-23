/** Case-sensitive full-name glob matching. Only * and ? have special meaning. */
export const matchesNamePattern = (name: string, pattern: string): boolean => {
  let n = 0;
  let p = 0;
  let star = -1;
  let retry = 0;
  while (n < name.length) {
    if (p < pattern.length && (pattern[p] === '?' || pattern[p] === name[n])) {
      n++;
      p++;
    } else if (pattern[p] === '*') {
      star = p++;
      retry = n;
    } else if (star !== -1) {
      p = star + 1;
      n = ++retry;
    } else {
      return false;
    }
  }
  while (pattern[p] === '*') p++;
  return p === pattern.length;
};
