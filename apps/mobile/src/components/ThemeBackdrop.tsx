import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState, type ReactNode } from 'react';
import { Image, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme';
import { useHeader } from './HeaderContext';

const PICTURE = require('../../assets/tea-shop-theme.png'); // page background: coffee leaves + tagline at the bottom
const HEADER = require('../../assets/theme-header.png'); // header art: brown gradient, table, cup and beans (904 x 234)
const PICTURE_RATIO = 1536 / 1024; // height / width of tea-shop-theme.png (Image.resolveAssetSource does not exist on web)
const HEADER_RATIO = 117 / 452; // height / width of theme-header.png
const CREAM = '#FEF1DB'; // the flat colour of the page
// where the emblem on the cup sits in the header art (the art itself has a blank cup): centre as a share of its width / height, and its size
const CUP_X = 777 / 904;
const CUP_Y = 166 / 234;
const CUP_SIZE = 0.072;
const BOTTOM_SHARE = 0.25; // the leaves + tagline live in the last quarter of the background picture

/**
 * Where the themed header lands on this screen. The art is as wide as the screen and keeps its own proportions (never stretched);
 * the strip behind the status bar is the art's own top edge mirrored, so there is no seam.
 * `artH`: height of the art (logo row, cup and the curve into the page). `headerH`: status bar + art, i.e. where page content starts.
 */
export function useBackdropGeometry() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const artH = Math.round(width * HEADER_RATIO);
  const barH = insets.top + artH;
  return { width, artH, top: insets.top, barH, headerH: barH, imgH: Math.round(width * PICTURE_RATIO) };
}

/** The page background: flat cream, with the coffee leaves and tagline at the bottom (never stretched). */
export function ThemeBackdrop() {
  const th = useTheme();
  const { width, imgH } = useBackdropGeometry();
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { overflow: 'hidden', backgroundColor: th.bg }]}>
      <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: CREAM, opacity: th.dark ? 0.4 : 1 }}>
        <View style={{ position: 'absolute', bottom: 0, left: 0, width, height: Math.round(imgH * BOTTOM_SHARE), overflow: 'hidden' }}>
          <Image source={PICTURE} resizeMode="stretch" style={{ position: 'absolute', left: 0, bottom: 0, width, height: imgH }} />
        </View>
      </View>
    </View>
  );
}

/** The header art, drawn behind the logo / names / buttons. Page content slides away under it. */
export function ThemeHeaderBg({ emblem = true }: { emblem?: boolean } = {}) {
  const th = useTheme();
  const { width, artH, top, barH } = useBackdropGeometry();
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: barH, overflow: 'hidden', backgroundColor: th.bg }}>
      <View style={{ ...StyleSheet.absoluteFillObject, opacity: th.dark ? 0.55 : 1 }}>
        {top > 0 ? <Image source={HEADER} resizeMode="stretch" style={{ position: 'absolute', left: 0, top: top + 1 - artH, width, height: artH, transform: [{ scaleY: -1 }] }} /> : null}
        <Image source={HEADER} resizeMode="stretch" style={{ position: 'absolute', left: 0, top, width, height: artH }} />
        {emblem ? <CupEmblem /> : null}
      </View>
    </View>
  );
}

/** Puts the page's header buttons where the art leaves room for them: top right, above the cup. */
export function HeaderRight({ children }: { children: ReactNode }) {
  const { width, artH, top } = useBackdropGeometry();
  return (
    <View style={{ position: 'absolute', right: Math.round(width * 0.025), top: top + Math.round(artH * 0.08), minHeight: Math.round(artH * 0.34), flexDirection: 'row', alignItems: 'center' }}>
      {children}
    </View>
  );
}

/** The business logo printed on the cup: it follows the company's logo, so changing the logo changes the cup too. */
function CupEmblem() {
  const header = useHeader();
  const { width, artH, top } = useBackdropGeometry();
  const [failed, setFailed] = useState(false);
  const d = Math.round(width * CUP_SIZE);
  const logo = header?.logo && !failed ? header.logo : null;
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', left: Math.round(width * CUP_X - d / 2), top: Math.round(top + artH * CUP_Y - d / 2), width: d, height: d, borderRadius: d / 2, overflow: 'hidden', backgroundColor: '#fbf1e3', borderWidth: 1, borderColor: 'rgba(113,56,23,0.35)', alignItems: 'center', justifyContent: 'center' }}
    >
      {logo
        ? <Image source={{ uri: logo }} resizeMode="contain" onError={() => setFailed(true)} style={{ width: d - 2, height: d - 2, borderRadius: (d - 2) / 2 }} />
        : <MaterialCommunityIcons name="coffee" size={d * 0.62} color="#713817" />}
    </View>
  );
}
