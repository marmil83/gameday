// Foamfinger logo — bold "#1" mark on an orange rounded tile.
// Conveys the foam-finger spirit ("we're #1!") via the numeral itself
// rather than an illustrated hand, which is more legible at small sizes
// and brand-consistent across favicons, headers, and share images.

interface LogoProps {
  className?: string;
  /** Background tile color. Defaults to Apple system orange. */
  bg?: string;
  /** Foreground text color. Defaults to white. */
  fg?: string;
  /** Pixel size — sets both width and height. Defaults to 24. */
  size?: number;
}

export default function Logo({ className, bg = '#FF9500', fg = '#ffffff', size = 24 }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="8" fill={bg} />
      <text
        x="16"
        y="16"
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
        fontSize="22"
        fontWeight="900"
        fill={fg}
        // Slight italic lean gives the "1" a sports-pennant feel
        transform="skewX(-6)"
        // Compensate the skew so the glyph sits visually centered in the tile
        dx="1"
      >
        1
      </text>
    </svg>
  );
}
