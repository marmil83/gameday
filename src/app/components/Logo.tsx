// Foamfinger logo — inline SVG so it scales crisply at any size and inherits color.
// Two overlapping rounded rectangles compose the iconic foam-finger silhouette:
// a tall pointing index finger over a fist/hand body. Pure shape, no text inside.

interface LogoProps {
  className?: string;
  color?: string;
  /** Pixel size — sets both width and height. Defaults to 24. */
  size?: number;
}

export default function Logo({ className, color = '#FF9500', size = 24 }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      fill={color}
      aria-hidden="true"
    >
      {/* Hand / fist body */}
      <rect x="6" y="14" width="20" height="14" rx="5" />
      {/* Index finger pointing up */}
      <rect x="13" y="3" width="6" height="13" rx="3" />
    </svg>
  );
}
