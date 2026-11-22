import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import { Text } from '@/components/Text';
import { pictureUri } from './Branding';

export const BIZ_TYPES: Record<string, string> = {
  TEA_SHOP: 'Tea shop', HOTEL: 'Hotel', RESTAURANT: 'Restaurant', BAKERY: 'Bakery', FRUIT_STALL: 'Fruit stall', VEGETABLE_SHOP: 'Vegetable shop', GROCERY: 'Grocery', OTHER: 'Other',
};
const TYPE_COLOR: Record<string, string> = { TEA_SHOP: '#1b2470', HOTEL: '#3b4cc0', RESTAURANT: '#b9382f', BAKERY: '#d9742b', FRUIT_STALL: '#d6336c', VEGETABLE_SHOP: '#2f855a', GROCERY: '#b7791f', OTHER: '#475569' };
export const BANNER_H = 118;

export interface BannerCompany { code: string; name: string; status: string; businessType: string; businessLogo?: string | null; businessFrame?: string | null }

/** A small round pencil button (white, on the banner). */
function Pencil({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={6} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3 }}>
      <Feather name="edit-2" size={14} color="#1e2a8a" />
    </Pressable>
  );
}

/**
 * Banner of a company: its application frame with the logo on the cup, else a colour for its shop type. In the company form the
 * pencils change the logo and the frame; the same picture carries on behind the form's fields (see FrameBackground).
 */
export function CompanyBanner({ c, onEditLogo, onEditFrame }: { c: BannerCompany; onEditLogo?: () => void; onEditFrame?: () => void }) {
  const [w, setW] = useState(0);
  const frame = pictureUri(c.businessFrame);
  const logo = c.businessLogo ? { uri: pictureUri(c.businessLogo) } : require('../../../assets/logo.png');
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ height: BANNER_H, overflow: 'hidden', backgroundColor: frame ? '#5f3013' : TYPE_COLOR[c.businessType] ?? '#1b2470', flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16 }}>
      {frame && w > 0 ? (
        <>
          <Image source={{ uri: frame }} resizeMode="stretch" style={{ position: 'absolute', left: 0, top: 0, width: w, height: w * 1.5 }} />
          {c.businessLogo ? <Image source={{ uri: pictureUri(c.businessLogo) }} resizeMode="contain" style={{ position: 'absolute', left: w * 0.831 - w * 0.0415, top: w * 1.5 * 0.1172 - w * 0.0415, width: w * 0.083, height: w * 0.083, borderRadius: w * 0.0415, backgroundColor: '#fbf1e3' }} /> : null}
        </>
      ) : null}
      <View>
        <Image source={logo} resizeMode="contain" style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: '#fff8ef', borderWidth: 2, borderColor: 'rgba(255,255,255,0.7)' }} />
        {onEditLogo ? <View style={{ position: 'absolute', right: -8, top: -8 }}><Pencil label="Change logo" onPress={onEditLogo} /></View> : null}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 11 }}>{c.code}</Text>
        <Text numberOfLines={1} style={{ color: '#fff', fontSize: 19, fontWeight: '800', textShadowColor: 'rgba(40,16,4,0.45)', textShadowRadius: 3, textShadowOffset: { width: 0, height: 1 } }}>{c.name}</Text>
        <View style={{ alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.22)', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 }}>
          <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{BIZ_TYPES[c.businessType] ?? c.businessType}</Text>
        </View>
      </View>
      <View style={{ alignSelf: 'flex-start', marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View style={{ backgroundColor: c.status === 'ACTIVE' ? '#ecfdf5' : '#f1f5f9', borderColor: c.status === 'ACTIVE' ? '#6ee7b7' : '#cbd5e1', borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
          <Text style={{ color: c.status === 'ACTIVE' ? '#065f46' : '#475569', fontSize: 12, fontWeight: '700' }}>{c.status === 'ACTIVE' ? 'Active' : 'Inactive'}</Text>
        </View>
        {onEditFrame ? <Pencil label="Change application frame" onPress={onEditFrame} /> : null}
      </View>
    </View>
  );
}

/** The rest of the frame picture, carried on from the banner above it (same width, starting where the banner ends). */
export function FrameBackground({ frame, children }: { frame: string | null | undefined; children: React.ReactNode }) {
  const [w, setW] = useState(0);
  const uri = pictureUri(frame);
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ backgroundColor: '#fef1db', overflow: 'hidden' }}>
      {uri && w > 0 ? <Image source={{ uri }} resizeMode="stretch" style={{ position: 'absolute', left: 0, top: -BANNER_H, width: w, height: w * 1.5 }} /> : null}
      {children}
    </View>
  );
}
