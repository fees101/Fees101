import { ImageResponse } from "next/og";

export const alt = "Fees101 — Revenue Operations Platform for Nigerian Schools";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#201e1d";
const PAPER = "#f3f2f2";
const SIGNAL = "#ec3013";

// Built from plain flex boxes rather than an external logo asset: the old
// public/brand/*.png files were removed as part of the in-progress redesign,
// and satori (the renderer behind ImageResponse) only supports a constrained
// HTML/CSS subset, not arbitrary <svg> markup. This mirrors the bars-mark
// shape from src/components/Logo.tsx (IconMark) using plain divs instead.
function BarsMark() {
  const barBase = { width: 34, display: "flex" } as const;
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 72 }}>
      <div style={{ ...barBase, height: "100%", background: INK }} />
      <div style={{ ...barBase, height: "100%", background: INK }} />
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <div style={{ width: 34, height: "68%", background: INK }} />
        <div style={{ width: 34, height: "32%", background: SIGNAL }} />
      </div>
    </div>
  );
}

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: PAPER,
          padding: 80,
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 2,
            border: `2px solid ${INK}`,
            color: INK,
            fontSize: 20,
            fontWeight: 700,
            letterSpacing: 2,
            textTransform: "uppercase",
            padding: "10px 20px",
            alignSelf: "flex-start",
          }}
        >
          Revenue Operations Platform
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
            <BarsMark />
            <div style={{ display: "flex", fontSize: 108, fontWeight: 800, letterSpacing: -2 }}>
              <span style={{ color: INK }}>FEES</span>
              <span style={{ color: SIGNAL }}>101</span>
            </div>
          </div>
          <div style={{ display: "flex", fontSize: 32, color: INK, maxWidth: 900 }}>
            Invoicing, payment tracking and automated reconciliation for
            Nigerian schools.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderTop: `2px solid ${INK}`,
            paddingTop: 24,
            fontSize: 22,
            color: INK,
            fontWeight: 600,
          }}
        >
          <span style={{ display: "flex" }}>fees101.com</span>
          <span style={{ display: "flex", color: SIGNAL }}>Dedicated virtual account per student</span>
        </div>
      </div>
    ),
    { ...size }
  );
}
