import { StyleSheet, Text as RNText, type TextProps, type TextStyle } from 'react-native';
import { tr } from '@/lib/i18n';
import { useTypography, weightOf } from '@/lib/typography';

type Node = TextProps['children'];

const translate = (c: Node): Node => {
  if (typeof c === 'string') return tr(c);
  if (Array.isArray(c)) return c.map((x) => (typeof x === 'string' ? tr(x) : x)) as Node;
  return c;
};

/**
 * Drop-in replacement for React Native's Text that shows the Tamil version of any plain English string it is given
 * (when the language is Tamil), in the company's chosen typeface and text size. Everything else (numbers, nested elements,
 * names that are not in the dictionary) is untouched.
 */
export function Text({ children, style, ...rest }: TextProps) {
  const ty = useTypography();
  let extra: TextStyle | null = null;
  if (ty.scale !== 1 || ty.family) {
    const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
    extra = {};
    if (ty.scale !== 1) {
      extra.fontSize = Math.round((flat.fontSize ?? 14) * ty.scale * 10) / 10;
      if (flat.lineHeight) extra.lineHeight = Math.round(flat.lineHeight * ty.scale * 10) / 10;
    }
    if (ty.family && !flat.fontFamily) {
      extra.fontFamily = ty.weights[weightOf(flat.fontWeight)];
      extra.fontWeight = 'normal'; // the weight is in the font file itself
    }
  }
  return <RNText {...rest} style={extra ? [style, extra] : style}>{translate(children)}</RNText>;
}
