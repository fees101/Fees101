import Image from "next/image";

// Real exported brand assets live in /public/brand — see that folder's README
// for the full usage-rules mapping (horizontal → headers, stacked → square
// spaces, icon → favicons/small UI).

export function IconMark({ size = 40 }: { size?: number }) {
  return (
    <Image
      src="/brand/icon.png"
      alt=""
      width={size}
      height={size}
      className="object-contain"
      priority
    />
  );
}

// Variant 1: Horizontal (full logo) — header, marketing materials.
export function LogoHorizontal({ height = 32 }: { height?: number }) {
  const width = Math.round(height * (900 / 222));
  return (
    <Image
      src="/brand/logo-horizontal.png"
      alt="Fees101"
      height={height}
      width={width}
      priority
      style={{ height, width: "auto" }}
    />
  );
}

// Variant 3: Stacked (icon above) — footer, square/social spaces.
export function LogoStacked({ height = 96 }: { height?: number }) {
  const width = Math.round(height * (282 / 303));
  return (
    <Image
      src="/brand/logo-stacked.png"
      alt="Fees101"
      height={height}
      width={width}
      style={{ height, width: "auto" }}
    />
  );
}
