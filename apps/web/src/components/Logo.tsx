/**
 * The Branch Pulse mark (public/logo.png): the green B and red P linked together. The artwork has a white background,
 * so it sits in a white rounded tile and reads the same on the light pages, the dark theme and the navy login banner.
 */
export function LogoMark({ size = 36, className = '' }: { size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.png" alt="" width={size} height={size} aria-hidden="true"
      className={`shrink-0 rounded-xl bg-white object-contain shadow-sm ring-1 ring-black/5 ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
