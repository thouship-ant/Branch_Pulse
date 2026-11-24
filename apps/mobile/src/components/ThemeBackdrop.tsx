import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useState, type ReactNode } from 'react';
import { Image, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { API_ORIGIN } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { useHeader } from './HeaderContext';
import { Text } from './Text';

const PICTURE = require('../../assets/tea-shop-theme.png'); // page background: coffee leaves + tagline at the bottom
const HEADER = require('../../assets/theme-header.png'); // header art: brown gradient, table, cup and beans (904 x 234)
const PICTURE_RATIO = 1536 / 1024; // height / width of tea-shop-theme.png (Image.resolveAssetSource does not exist on web)
const HEADER_RATIO = 117 / 452; // height / width of theme-header.png
const CREAM = '#FEF1DB'; // the flat colour of the page
// where the emblem on the cup sits in the header art (the art itself has a blank cup): centre as a share of its width / height, and its size
const CUP_X = 777 / 904;
const CUP_Y = 166 / 234;
const CUP_SIZE = 0.072;
// the same for a company's own frame picture (1024 x 1536, empty cup at the top right)
const FRAME_CUP_X = 851 / 1024;
const FRAME_CUP_Y = 180 / 1536;
const FRAME_CUP_SIZE = 85 / 1024;
// a company frame in the header: the picture is drawn from the very top, enlarged by FRAME_ZOOM and kept to the right edge (so the cup
// is a little lower and bigger, clear of the header buttons) with no gap, mirror or stretch: the header shows its top FRAME_VISIBLE
// (header band, the whole cup and saucer) and the page carries on with the same picture
const FRAME_VISIBLE = 0.178;
const FRAME_ZOOM = 1.0; // the picture at the screen's width: the header is the same height as the standard themed header
const FRAME_SHIFT = 0.05; // the picture sits this much (of the width) below the status bar, so the cup is under the header buttons; the strip above is its own top row carried upward, so there is no seam
const BOTTOM_SHARE = 0.25; // the leaves + tagline live in the last quarter of the background picture

/**
 * Where the themed header lands on this screen. The art is as wide as the screen and keeps its own proportions (never stretched);
 * the strip behind the status bar is the art's own top edge mirrored, so there is no seam.
 * `artH`: height of the art (logo row, cup and the curve into the page). `headerH`: status bar + art, i.e. where page content starts.
 */
export function useBackdropGeometry() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { me } = useSession();
  const hasFrame = !!me?.company?.businessFrame;
  const imgH = Math.round(width * PICTURE_RATIO);
  const frameShift = hasFrame ? Math.round(width * FRAME_SHIFT) : 0;
  const barH = insets.top + Math.round(width * HEADER_RATIO) + frameShift; // the standard header height, with or without a frame
  const artH = barH - insets.top;
  // framed: the brown band above the picture's curve (its left edge), where the logo and title are centred
  const bandH = insets.top + Math.round(width * 0.2295 * FRAME_ZOOM) + frameShift;
  return { width, artH, top: insets.top, barH, headerH: barH, imgH, framed: hasFrame, bandH, frameShift, frameTop: insets.top + frameShift };
}

/** The strip above a lowered frame: the picture's own top row, carried upward (it is soft brown), so the picture starts without a seam. */
function FrameTopSmear({ source, width, shift }: { source: any; width: number; shift: number }) {
  if (shift <= 0) return null;
  const imgW = Math.round(width * FRAME_ZOOM);
  return (
    <View style={{ position: 'absolute', left: 0, top: 0, width, height: shift + 1, overflow: 'hidden' }}>
      <Image source={source} resizeMode="stretch" style={{ position: 'absolute', left: width - imgW, top: 0, width: imgW, height: Math.round((shift + 1) / 0.004) }} />
    </View>
  );
}

/** The page background: flat cream, with the coffee leaves and tagline at the bottom (never stretched). */
export function ThemeBackdrop() {
  const th = useTheme();
  const { me } = useSession();
  const { width, imgH, frameTop } = useBackdropGeometry();
  // the company's own application frame (about 2:3, like the default picture), when it has one
  const frame = me?.company?.businessFrame;
  const source = frame ? { uri: `${API_ORIGIN}${frame}` } : PICTURE;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { overflow: 'hidden', backgroundColor: th.bg }]}>
      <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: CREAM, opacity: th.dark ? 0.4 : 1 }}>
        {/* a company frame carries on under the header: the same picture at the same place, so there is no line between header and page */}
        {frame ? (
          <View style={{ position: 'absolute', left: 0, top: 0, width, height: Math.round(imgH * FRAME_ZOOM * 0.3) + frameTop, overflow: 'hidden' }}>
            <FrameTopSmear source={source} width={width} shift={frameTop} />
            <Image source={source} resizeMode="stretch" style={{ position: 'absolute', left: width - Math.round(width * FRAME_ZOOM), top: frameTop, width: Math.round(width * FRAME_ZOOM), height: Math.round(imgH * FRAME_ZOOM) }} />
          </View>
        ) : null}
        <View style={{ position: 'absolute', bottom: 0, left: 0, width, height: Math.round(imgH * BOTTOM_SHARE), overflow: 'hidden' }}>
          <Image source={source} resizeMode="stretch" style={{ position: 'absolute', left: 0, bottom: 0, width, height: imgH }} />
        </View>
      </View>
    </View>
  );
}

/** The theme picture inside a pop-up: flat cream with the coffee leaves and tagline along the bottom (it sits behind the pop-up's content). */
export function ThemeSheetBackdrop() {
  const th = useTheme();
  const { me } = useSession();
  const { width, imgH } = useBackdropGeometry();
  const frame = me?.company?.businessFrame;
  const source = frame ? { uri: `${API_ORIGIN}${frame}` } : PICTURE;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { overflow: 'hidden', backgroundColor: CREAM, opacity: th.dark ? 0.4 : 1 }]}>
      <View style={{ position: 'absolute', bottom: 0, left: 0, width, height: Math.round(imgH * BOTTOM_SHARE), overflow: 'hidden' }}>
        <Image source={source} resizeMode="stretch" style={{ position: 'absolute', left: 0, bottom: 0, width, height: imgH }} />
      </View>
    </View>
  );
}

/** The themed header of a pop-up: the same art as the page header (the company's own frame when it has one), the title on the left and the close button at the top right; the body scrolls below it. */
export function ThemeSheetHeader({ title, onClose }: { title: string; onClose: () => void }) {
  const { me } = useSession();
  const { width, imgH } = useBackdropGeometry();
  const h = Math.round(width * HEADER_RATIO);
  const frame = me?.company?.businessFrame ? `${API_ORIGIN}${me.company.businessFrame}` : null;
  return (
    <View style={{ height: h, width, overflow: 'hidden' }}>
      {frame
        ? <Image source={{ uri: frame }} resizeMode="stretch" style={{ position: 'absolute', left: 0, top: 0, width, height: imgH }} />
        : <Image source={HEADER} resizeMode="stretch" style={{ position: 'absolute', left: 0, top: 0, width, height: h }} />}
      <CupEmblem x={frame ? FRAME_CUP_X : CUP_X} y={frame ? imgH * FRAME_CUP_Y : h * CUP_Y} size={frame ? FRAME_CUP_SIZE : CUP_SIZE} />
      <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8} style={{ position: 'absolute', left: 18, top: Math.round(h * 0.16), right: Math.round(width * 0.4), color: '#fff', fontSize: 20, fontWeight: '800', textShadowColor: 'rgba(40,16,4,0.55)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 }}>{title}</Text>
      <Pressable onPress={onClose} accessibilityLabel="Close" hitSlop={12} style={({ pressed }) => ({ position: 'absolute', right: Math.round(width * 0.025), top: 6, transform: [{ translateY: pressed ? 2 : 0 }], width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fffaf4', borderWidth: 1, borderColor: '#f0d9bd', borderBottomWidth: 3, borderBottomColor: '#d9b48a', shadowColor: '#2a0e03', shadowOpacity: 0.45, shadowRadius: 5, shadowOffset: { width: 0, height: 3 }, elevation: 6 })}>
        <Feather name="x" size={22} color="#6a2a0e" />
      </Pressable>
    </View>
  );
}

/** The header art, drawn behind the logo / names / buttons. Page content slides away under it. */
export function ThemeHeaderBg({ emblem = true }: { emblem?: boolean } = {}) {
  const th = useTheme();
  const { me } = useSession();
  const { width, artH, top, barH, frameTop } = useBackdropGeometry();
  // the company's own application frame (about 2:3): its top is the header, its empty cup carries the company logo
  const frame = me?.company?.businessFrame ? `${API_ORIGIN}${me.company.businessFrame}` : null;
  const frameH = Math.round(width * PICTURE_RATIO);
  if (frame) {
    // the picture itself is the page background (ThemeBackdrop), so the header has no edge of its own: only the logo on the cup is drawn here
    return (
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: barH }}>
        {emblem ? <CupEmblem x={1 - FRAME_ZOOM * (1 - FRAME_CUP_X)} y={frameTop + frameH * FRAME_ZOOM * FRAME_CUP_Y} size={FRAME_CUP_SIZE * FRAME_ZOOM} /> : null}
      </View>
    );
  }
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: barH, overflow: 'hidden', backgroundColor: th.bg }}>
      <View style={{ ...StyleSheet.absoluteFillObject, opacity: th.dark ? 0.55 : 1 }}>
        {top > 0 ? <Image source={HEADER} resizeMode="stretch" style={{ position: 'absolute', left: 0, top: top + 1 - artH, width, height: artH, transform: [{ scaleY: -1 }] }} /> : null}
        <Image source={HEADER} resizeMode="stretch" style={{ position: 'absolute', left: 0, top, width, height: artH }} />
        {emblem ? <CupEmblem x={CUP_X} y={top + artH * CUP_Y} size={CUP_SIZE} /> : null}
      </View>
      <HeaderFade />
    </View>
  );
}

/**
 * The lower edge of the header melts into the page colour (no hard line), and whatever slides up under the header fades out
 * instead of being cut. Light theme only: the dark page is not this cream.
 */
const FADE_BANDS = 5;
const FADE_BAND_H = 2;
function HeaderFade() {
  const th = useTheme();
  if (th.dark) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: FADE_BANDS * FADE_BAND_H }}>
      {Array.from({ length: FADE_BANDS }, (_, i) => (
        <View key={i} style={{ height: FADE_BAND_H, backgroundColor: CREAM, opacity: (i + 1) / (FADE_BANDS + 1) }} />
      ))}
    </View>
  );
}

/** Puts the page's header buttons where the art leaves room for them: top right, above the cup. */
export function HeaderRight({ children }: { children: ReactNode }) {
  const { width, artH, top, framed } = useBackdropGeometry();
  // with a company frame the header is taller (room above the cup): the buttons hug the top instead of floating in the middle of that room
  return (
    <View style={{ position: 'absolute', right: Math.round(width * 0.025), top: top + (framed ? 4 : Math.round(artH * 0.08)), minHeight: framed ? 34 : Math.round(artH * 0.34), flexDirection: 'row', alignItems: framed ? 'flex-start' : 'center' }}>
      {children}
    </View>
  );
}

/** The business logo printed on the cup: it follows the company's logo, so changing the logo changes the cup too. */
function CupEmblem({ x, y, size }: { x: number; y: number; size: number }) {
  const header = useHeader();
  const { width } = useBackdropGeometry();
  const [failed, setFailed] = useState(false);
  const d = Math.round(width * size);
  const logo = header?.logo && !failed ? header.logo : null;
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', left: Math.round(width * x - d / 2), top: Math.round(y - d / 2), width: d, height: d, borderRadius: d / 2, overflow: 'hidden', backgroundColor: '#fbf1e3', borderWidth: 1, borderColor: 'rgba(113,56,23,0.35)', alignItems: 'center', justifyContent: 'center' }}
    >
      {logo
        ? <Image source={{ uri: logo }} resizeMode="contain" onError={() => setFailed(true)} style={{ width: d - 2, height: d - 2, borderRadius: (d - 2) / 2 }} />
        : <MaterialCommunityIcons name="coffee" size={d * 0.62} color="#713817" />}
    </View>
  );
}
