import { Text as RNText, type TextProps } from 'react-native';
import { tr } from '@/lib/i18n';

type Node = TextProps['children'];

const translate = (c: Node): Node => {
  if (typeof c === 'string') return tr(c);
  if (Array.isArray(c)) return c.map((x) => (typeof x === 'string' ? tr(x) : x)) as Node;
  return c;
};

/**
 * Drop-in replacement for React Native's Text that shows the Tamil version of any plain English string it is given
 * (when the language is Tamil). Everything else (numbers, nested elements, names that are not in the dictionary) is untouched.
 */
export function Text({ children, ...rest }: TextProps) {
  return <RNText {...rest}>{translate(children)}</RNText>;
}
