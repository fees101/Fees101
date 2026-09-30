// Brand mark: three buildings (black, black with ledger-line window cuts,
// signal-red) beside the FEES101 wordmark. Shipped as PNG lockups from
// docs/brand-concepts/buildings-101/, copied into public/brand/ — see
// public/brand/README.md. Colour variants are separate exported files
// (default vs. invert for the dark footer), not a runtime fill swap.

export function IconMark({
  size = 40,
  variant = "default",
}: {
  size?: number;
  variant?: "default" | "invert";
}) {
  const src = variant === "invert" ? "/brand/icon-invert.png" : "/brand/icon.png";
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" style={{ height: size, width: "auto" }} className="shrink-0" />
  );
}

// Variant 1: Horizontal (full logo) — header, marketing materials.
export function LogoHorizontal({
  height = 32,
  variant = "default",
}: {
  height?: number;
  variant?: "default" | "invert";
}) {
  const src =
    variant === "invert" ? "/brand/logo-horizontal-invert.png" : "/brand/logo-horizontal.png";
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="Fees101" style={{ height, width: "auto" }} />
  );
}

// Variant 3: Stacked (icon above wordmark) — footer, square/social spaces.
export function LogoStacked({ height = 96 }: { height?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/brand/logo-stacked.png" alt="Fees101" style={{ height, width: "auto" }} />
  );
}
