// Local stand-ins for the lucide-react icons this app uses. lucide-react is
// listed in package.json but the corporate npm registry (npm.dev.paypalinc.com)
// returns a flat 403 on it (confirmed on any version — not a resolution issue,
// the package itself is blocked), and the public registry is blocked by
// Zscaler, so `npm install` can't get it onto this machine. These are plain
// inline SVGs matching lucide's 24x24/stroke-based visual style and prop shape
// (`size`, `strokeWidth`, plus passthrough SVG props), so swapping back to the
// real `lucide-react` import later — once it's reachable from some registry —
// is a one-line change per file, not a rewrite.
import type { SVGProps } from 'react'

interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number | string
  strokeWidth?: number | string
}

function base(children: React.ReactNode) {
  return function Icon({ size = 24, strokeWidth = 2, ...props }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        {...props}
      >
        {children}
      </svg>
    )
  }
}

export const LayoutDashboard = base(
  <>
    <rect x="3" y="3" width="7" height="9" rx="1" />
    <rect x="14" y="3" width="7" height="5" rx="1" />
    <rect x="14" y="12" width="7" height="9" rx="1" />
    <rect x="3" y="16" width="7" height="5" rx="1" />
  </>
)

export const Building2 = base(
  <>
    <path d="M6 21V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v17" />
    <path d="M14 9h5a1 1 0 0 1 1 1v11" />
    <path d="M3 21h18" />
    <path d="M9 8h.01M12 8h.01M9 12h.01M12 12h.01M9 16h.01M12 16h.01M17 13h.01M17 17h.01" />
  </>
)

export const Receipt = base(
  <>
    <path d="M4 3h16v18l-3-2-2 2-2-2-2 2-2-2-2 2-3-2z" />
    <path d="M8 8h8M8 12h8M8 16h5" />
  </>
)

export const Activity = base(<path d="M22 12h-4l-3 9L9 3l-3 9H2" />)

export const UserPlus = base(
  <>
    <path d="M8 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
    <path d="M2 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
    <path d="M19 8v6M22 11h-6" />
  </>
)

export const ScrollText = base(
  <>
    <path d="M8 21h9a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2v14a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-3h4" />
    <path d="M12 9h5M12 13h5" />
  </>
)

export const Settings = base(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </>
)

export const AlertTriangle = base(
  <>
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <path d="M12 9v4M12 17h.01" />
  </>
)

export const Users = base(
  <>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </>
)

export const ArrowRight = base(
  <>
    <path d="M5 12h14" />
    <path d="M12 5l7 7-7 7" />
  </>
)
