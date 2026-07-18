/** ClipVault brand mark: a clipboard with a keyhole (vault). Inline SVG so it inherits
 *  `currentColor` — set the color via a `text-*` class. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect x="4" y="4" width="16" height="18" rx="3.2" fill="currentColor" opacity="0.16" />
      <rect
        x="4.75"
        y="4.75"
        width="14.5"
        height="16.5"
        rx="2.6"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect x="9" y="2.4" width="6" height="4" rx="1.4" fill="currentColor" />
      <circle cx="12" cy="12.2" r="2.1" fill="currentColor" />
      <rect x="11.05" y="13" width="1.9" height="3.7" rx="0.95" fill="currentColor" />
    </svg>
  );
}
