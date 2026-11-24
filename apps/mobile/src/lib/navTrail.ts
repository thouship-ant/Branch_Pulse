import { usePathname, useGlobalSearchParams, type Router } from 'expo-router';
import { useEffect } from 'react';

/**
 * The pages the person has been through in the back office, most recent last. The tabs and the More sections are separate navigators,
 * so the built-in back would land on whatever page was last open inside the section, not on the page the person came from.
 */
const trail: string[] = [];

/** Record every page change (mount once, in the office layout). */
export function useNavTrail() {
  const path = usePathname();
  const params = useGlobalSearchParams();
  const query = Object.entries(params).filter(([, v]) => typeof v === 'string' && v).map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`).join('&');
  useEffect(() => () => { trail.length = 0; }, []); // signing out / switching area starts a fresh trail
  const here = query ? `${path}?${query}` : path;
  useEffect(() => {
    if (trail[trail.length - 1] === here) return;
    // arriving on the page just before the current one means "back": drop the page we left
    if (trail.length >= 2 && trail[trail.length - 2].split('?')[0] === path) trail.pop();
    else { trail.push(here); if (trail.length > 40) trail.shift(); }
    trail[trail.length - 1] = here;
  }, [here, path]);
}

/** Goes to the page before this one. false when there is none (the caller falls back to the usual back). */
export function goBackInTrail(router: Router): boolean {
  if (trail.length < 2) return false;
  router.navigate(trail[trail.length - 2] as any);
  return true;
}
