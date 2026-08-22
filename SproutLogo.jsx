// SproutLogo.jsx — official Sprout horizontal lockup (icon + wordmark).
// Framework-agnostic React; works in Next.js / Vite / CRA.
// Requires the "Geist" font to be loaded (see handoff doc).
//
//   <SproutLogo />                 // default, for dark backgrounds
//   <SproutLogo height={20} />     // smaller (e.g. compact nav)
//   <SproutLogo variant="light" /> // for light backgrounds
//   <SproutLogo variant="mono" color="#2FBE73" /> // single-color
//
// `height` is the wordmark font-size in px; the icon is auto-sized to match
// its visual height (ratio 1.48) and the gap scales with it.

import React, { useId } from "react";

export function SproutMark({ size = 32, variant = "gradient", color }) {
  const gid = useId();
  const paint = variant === "gradient" ? `url(#${gid})` : (color || "currentColor");
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none"
      xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Sprout"
      style={{ display: "block", flex: "0 0 auto" }}>
      {variant === "gradient" && (
        <defs>
          <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1="32" y1="20" x2="60" y2="95">
            <stop offset="0" stopColor="#5FE39B" />
            <stop offset="1" stopColor="#1E9E5E" />
          </linearGradient>
        </defs>
      )}
      <path d="M50 91 C 49 73 47 64 55 56" stroke={paint} strokeWidth="7" strokeLinecap="round" />
      <path d="M54 60 Q77.2 53.7 81 30 Q57.8 36.3 54 60 Z" fill={paint} />
      <path d="M50 64 Q45.1 46.5 27 44 Q31.9 61.6 50 64 Z" fill={paint} />
    </svg>
  );
}

export function SproutLogo({ height = 28, variant = "gradient", color }) {
  const fs = height;
  const iconSize = Math.round(fs * 1.48);
  // wordmark color: dark ink on light bg, near-white on dark bg, or explicit
  const wordColor = color || (variant === "light" ? "#0C2218" : "#EAF2EC");
  const markVariant = variant === "gradient" ? "gradient" : "mono";
  const markColor = variant === "gradient" ? undefined : (color || "#2FBE73");
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: Math.round(fs * 0.32) }}>
      <SproutMark size={iconSize} variant={markVariant} color={markColor} />
      <span style={{
        fontFamily: "'Geist', system-ui, sans-serif",
        fontWeight: 600,
        letterSpacing: "-0.035em",
        fontSize: fs,
        lineHeight: 1,
        color: wordColor,
      }}>Sprout</span>
    </span>
  );
}

export default SproutLogo;
