import { UriTemplate } from '../clients/mcpSdkClient.js';

const MAX_URI_LENGTH = 4096;
const MAX_TEMPLATE_LENGTH = 512;

type Part = string | { operator: string; names: string[]; exploded: boolean };
type CharTest = (char: string) => boolean;
type Element =
  | { kind: 'literal'; char: string }
  | { kind: 'plus'; test: CharTest }
  | { kind: 'list'; test: CharTest };

const OPERATORS = ['+', '#', '.', '/', '?', '&'];
const segmentChar: CharTest = (char) => char !== '/' && char !== ',';
const anyChar: CharTest = (char) => !'\n\r\u2028\u2029'.includes(char);
const queryValueChar: CharTest = (char) => char !== '&';

// Same parts as the SDK's UriTemplate parser.
const parseTemplate = (template: string): Part[] => {
  const parts: Part[] = [];
  let literal = '';
  for (let i = 0; i < template.length; i++) {
    if (template[i] !== '{') {
      literal += template[i];
      continue;
    }
    if (literal) parts.push(literal);
    literal = '';
    const end = template.indexOf('}', i);
    const expression = template.slice(i + 1, end);
    const operator = OPERATORS.find((op) => expression.startsWith(op)) ?? '';
    const names = expression
      .slice(operator.length)
      .split(',')
      .map((name) => name.replace('*', '').trim())
      .filter((name) => name.length > 0);
    parts.push({ operator, names, exploded: expression.includes('*') });
    i = end;
  }
  if (literal) parts.push(literal);
  return parts;
};

const literalElements = (text: string): Element[] =>
  text.split('').map((char) => ({ kind: 'literal', char }));

// Mirrors the SDK's partToRegExp patterns, which match() joins into one regex.
const toElements = (parts: Part[]): Element[] =>
  parts.flatMap((part): Element[] => {
    if (typeof part === 'string') return literalElements(part);
    switch (part.operator) {
      case '?':
      case '&':
        return part.names.flatMap((name, index) => [
          ...literalElements(`${index === 0 ? part.operator : '&'}${name}=`),
          { kind: 'plus', test: queryValueChar },
        ]);
      case '+':
      case '#':
        return [{ kind: 'plus', test: anyChar }];
      case '.':
        return [...literalElements('.'), { kind: 'plus', test: segmentChar }];
      case '/':
        return [
          ...literalElements('/'),
          { kind: part.exploded ? 'list' : 'plus', test: segmentChar },
        ];
      default:
        return [{ kind: part.exploded ? 'list' : 'plus', test: segmentChar }];
    }
  });

// Linear-time equivalent of the SDK's regex match. The SDK regex backtracks
// polynomially when expressions share a segment (`{year}-{month}-{day}`), which
// would let one resources/read request block the event loop.
// States: 3 * element index + 0 (before), 1 (inside), 2 (after a list comma).
const matchElements = (elements: Element[], input: string): boolean => {
  const accept = 3 * elements.length;
  const close = (states: Set<number>): Set<number> => {
    for (const state of states) {
      if (state % 3 === 1) states.add(3 * (Math.floor(state / 3) + 1));
    }
    return states;
  };
  let states = close(new Set([0]));
  // UTF-16 code units, like the SDK's non-unicode regex.
  for (const char of input.split('')) {
    const next = new Set<number>();
    for (const state of states) {
      if (state === accept) continue;
      const index = Math.floor(state / 3);
      const element = elements[index];
      const phase = state % 3;
      if (element.kind === 'literal') {
        if (char === element.char) next.add(3 * (index + 1));
      } else if (element.test(char)) {
        next.add(3 * index + 1);
      } else if (element.kind === 'list' && phase === 1 && char === ',') {
        next.add(3 * index + 2);
      }
    }
    if (next.size === 0) return false;
    states = close(next);
  }
  return states.has(accept);
};

type CompiledTemplate = {
  elements: Element[];
  // Elements before trailing `{?...}`/`{&...}` expansions, and the names they declare.
  base?: { elements: Element[]; names: string[]; exploded: boolean };
};

const compiledTemplates = new Map<string, CompiledTemplate | null>();
const MAX_COMPILED_TEMPLATES = 1000;

const compileTemplate = (template: string): CompiledTemplate | null => {
  if (compiledTemplates.has(template)) {
    return compiledTemplates.get(template)!;
  }
  let compiled: CompiledTemplate | null;
  try {
    // The SDK still validates the template (syntax and size limits).
    new UriTemplate(template);
    const parts = parseTemplate(template);
    compiled = { elements: toElements(parts) };
    let start = parts.length;
    while (start > 0) {
      const part = parts[start - 1];
      if (typeof part === 'string' || (part.operator !== '?' && part.operator !== '&')) break;
      start--;
    }
    const baseParts = parts.slice(0, start);
    if (
      start < parts.length &&
      !baseParts.some((part) => typeof part === 'string' && part.includes('?'))
    ) {
      const queryParts = parts.slice(start) as Exclude<Part, string>[];
      compiled.base = {
        elements: toElements(baseParts),
        names: queryParts.flatMap((part) => part.names),
        exploded: queryParts.some((part) => part.exploded),
      };
    }
  } catch {
    compiled = null;
  }
  if (compiledTemplates.size >= MAX_COMPILED_TEMPLATES) {
    compiledTemplates.clear();
  }
  compiledTemplates.set(template, compiled);
  return compiled;
};

// The SDK matcher requires every query variable, in order, so `x{?a}` would not
// match `x`. Match the part before trailing query expansions separately.
export const uriMatchesResourceTemplate = (uriTemplate: string, uri: string): boolean => {
  if (
    typeof uriTemplate !== 'string' ||
    typeof uri !== 'string' ||
    uriTemplate.length > MAX_TEMPLATE_LENGTH ||
    uri.length > MAX_URI_LENGTH
  ) {
    return false;
  }
  const compiled = compileTemplate(uriTemplate);
  if (!compiled) {
    return false;
  }
  if (matchElements(compiled.elements, uri)) {
    return true;
  }
  if (!compiled.base) {
    return false;
  }

  const queryStart = uri.indexOf('?');
  if (!matchElements(compiled.base.elements, queryStart === -1 ? uri : uri.slice(0, queryStart))) {
    return false;
  }
  if (queryStart === -1 || compiled.base.exploded) {
    return true;
  }
  const allowed = new Set(compiled.base.names.map((name) => name.replace(/:\d+$/, '')));
  for (const key of new URLSearchParams(uri.slice(queryStart + 1)).keys()) {
    if (!allowed.has(key)) {
      return false;
    }
  }
  return true;
};
