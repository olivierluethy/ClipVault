/**
 * Minimal line-icon set (lucide-style geometry) as inline SVG so every glyph inherits
 * `currentColor` and stays crisp. Replaces the emoji that made rows look cluttered.
 */
type IconProps = { className?: string };

function Svg({ className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? "h-4 w-4"}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const CopyIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h8" />
  </Svg>
);

export const PinIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 17v5" />
    <path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6Z" />
  </Svg>
);

export const FolderIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7a2 2 0 0 1 2-2h3l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z" />
  </Svg>
);

export const FolderPlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7a2 2 0 0 1 2-2h3l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z" />
    <path d="M12 11v4M10 13h4" />
  </Svg>
);

export const EditIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
  </Svg>
);

export const TrashIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
  </Svg>
);

export const EyeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="2.6" />
  </Svg>
);

export const QrIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="4" width="6" height="6" rx="1" />
    <rect x="14" y="4" width="6" height="6" rx="1" />
    <rect x="4" y="14" width="6" height="6" rx="1" />
    <path d="M14 14h3v3M20 14v.01M14 20h.01M20 17v3" />
  </Svg>
);

export const ExternalLinkIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 4h6v6M20 4l-9 9" />
    <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
  </Svg>
);

export const MoreIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="5" cy="12" r="1.4" />
    <circle cx="12" cy="12" r="1.4" />
    <circle cx="19" cy="12" r="1.4" />
  </Svg>
);

export const ChevronLeftIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15 6l-6 6 6 6" />
  </Svg>
);

export const ChevronRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 6l6 6-6 6" />
  </Svg>
);

/** Telephone handset — the Phone Numbers category. */
export const PhoneIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 5c0-.6.4-1 1-1h2.3c.5 0 .9.3 1 .8l.7 2.6c.1.4 0 .8-.3 1.1L8 9.8a11 11 0 0 0 4.2 4.2l1.3-1.3c.3-.3.7-.4 1.1-.3l2.6.7c.5.1.8.5.8 1V16c0 .6-.4 1-1 1A13 13 0 0 1 4 5Z" />
  </Svg>
);

/** Drag-handle grip (two columns of dots) for reorderable rows. */
export const GripIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="6" r="1.3" />
    <circle cx="15" cy="6" r="1.3" />
    <circle cx="9" cy="12" r="1.3" />
    <circle cx="15" cy="12" r="1.3" />
    <circle cx="9" cy="18" r="1.3" />
    <circle cx="15" cy="18" r="1.3" />
  </Svg>
);

export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12.5 10 17.5 19.5 6.5" />
  </Svg>
);

export const SearchIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.2-3.2" />
  </Svg>
);

export const CalendarIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="17" height="16" rx="2" />
    <path d="M3.5 9h17M8 3v4M16 3v4" />
  </Svg>
);

export const PlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

// A vertical axis with dated nodes — echoes the date rail's spine so the narrow
// jump control reads as the same feature, and stays distinct from the filter's
// calendar grid.
export const TimelineIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 4v16" />
    <circle cx="6" cy="7" r="1.4" />
    <circle cx="6" cy="12" r="1.4" />
    <circle cx="6" cy="17" r="1.4" />
    <path d="M10 7h9M10 12h7M10 17h8" />
  </Svg>
);

export const XIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);

export const MenuIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </Svg>
);

export const ShieldIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3 5 6v5c0 4 3 6.5 7 8 4-1.5 7-4 7-8V6l-7-3Z" />
  </Svg>
);

export const SlidersIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h6M14 18h6" />
    <circle cx="16" cy="6" r="2" />
    <circle cx="8" cy="12" r="2" />
    <circle cx="12" cy="18" r="2" />
  </Svg>
);

export const CleanIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 21c2-3 3-4 6-7M13 7l4 4M14 3l7 7-4 2-5-5 2-4Z" />
  </Svg>
);

export const TextIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 6h14M5 6V5M5 6v1M12 6v13M9 19h6" />
  </Svg>
);

export const LayersIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3 3 8l9 5 9-5-9-5Z" />
    <path d="M3 13l9 5 9-5M3 16.5l9 5 9-5" opacity="0.5" />
  </Svg>
);

export const HashIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 4 7 20M17 4l-2 16M5 9h15M4 15h15" />
  </Svg>
);

export const ImageIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="4" width="16" height="16" rx="2.5" />
    <circle cx="9" cy="9.5" r="1.6" />
    <path d="m5 17 4.5-4.5L14 17l2.5-2.5L20 18" />
  </Svg>
);

// A flame — marks the "Frequent" smart view (the items you reach for most, kept hot).
export const FlameIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3c.5 3-2 4-2 4C7 9 6 11.5 6 14a6 6 0 0 0 12 0c0-2.2-1-4-2.5-5.3.2 2-1 3-1.8 3.3.6-2.2-.4-4.7-1.7-6Z" />
  </Svg>
);

// Two chasing arrows — reads as "captured again", used by the copy-count badge.
export const RepeatIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M17 2.5 20.5 6 17 9.5" />
    <path d="M3.5 11V9.5a3.5 3.5 0 0 1 3.5-3.5h13.5" />
    <path d="M7 21.5 3.5 18 7 14.5" />
    <path d="M20.5 13v1.5a3.5 3.5 0 0 1-3.5 3.5H3.5" />
  </Svg>
);

// Two swapping arrows over a bar — marks the "Find & replace" action.
export const ReplaceIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 5h9M4 5l2.5-2.5M4 5l2.5 2.5" />
    <path d="M20 13h-9M20 13l-2.5-2.5M20 13l-2.5 2.5" />
    <path d="M5 19h14" />
  </Svg>
);

// A magic wand with a sparkle — marks the non-destructive "Transform" text actions.
export const WandIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15 4V2M15 10V8M18 7h2M10 7h2" />
    <path d="M4.5 19.5 16 8l-.5-.5L4 19l.5.5ZM13.5 6 18 10.5" />
  </Svg>
);

// A chevron pair '</>' — marks code-detail / "view as code".
export const CodeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 8l-4 4 4 4M16 8l4 4-4 4" />
  </Svg>
);

// A clock — marks ephemeral / self-destruct (auto-delete) entries.
export const ClockIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
);

export const LockIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
    <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
  </Svg>
);

export const EyeOffIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 3l18 18" />
    <path d="M10.6 6.1A9.7 9.7 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3.2 3.9M6.2 6.2A17 17 0 0 0 2 12s3.5 6 10 6a9.6 9.6 0 0 0 4-.86" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  </Svg>
);

// A page with a folded corner — marks entries copied out of a file manager.
export const FileIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
    <path d="M14 3v5h5" />
  </Svg>
);

// A bookmarked page — marks the Snippets library: things you wrote to reuse.
export const SnippetIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-3.5L6 21V4.5Z" />
    <path d="M9.5 8h5" />
  </Svg>
);

// Two offset sheets — marks the "Similar" view, where entries come in stacks.
export const StackIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.5" />
    <path d="M15.5 5.5A2.5 2.5 0 0 0 13 4H6.5A2.5 2.5 0 0 0 4 6.5V13a2.5 2.5 0 0 0 1.5 2.3" opacity="0.6" />
  </Svg>
);

export const SwatchIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="9" r="3" />
    <circle cx="15.5" cy="9" r="3" opacity="0.5" />
    <circle cx="12" cy="15" r="3" opacity="0.75" />
  </Svg>
);

