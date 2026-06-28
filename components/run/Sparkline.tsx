"use client";

export function Sparkline({
  values,
  width = 64,
  height = 22,
  color,
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (!values || values.length < 2) {
    return (
      <svg width={width} height={height} aria-hidden>
        <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="var(--color-ink-dim)" strokeWidth="1" strokeDasharray="2 2" opacity="0.4" />
      </svg>
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pad = 2;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (width - pad * 2);
    const y = pad + (1 - (v - min) / range) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const up = values[values.length - 1] >= values[0];
  const stroke = color ?? (up ? "#7f8b52" : "#a33218");
  return (
    <svg width={width} height={height} aria-hidden style={{ overflow: "visible" }}>
      <polyline points={pts.join(" ")} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1].split(",")[0]} cy={pts[pts.length - 1].split(",")[1]} r="1.8" fill={stroke} />
    </svg>
  );
}
