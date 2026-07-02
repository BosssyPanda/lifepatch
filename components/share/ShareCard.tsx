"use client";

import { useEffect, useRef, useState } from "react";
import { CloseIcon } from "@/components/icons";
import { drawShareCard, FORMATS, type ShareCardData, type ShareFormat } from "./drawShareCard";

/**
 * Share-card preview + export (Addendum A §7.2). Renders the palette-locked card to
 * an offscreen canvas on open, shows a preview, and offers Download (PNG) + Web Share
 * (with a download fallback). Story (1080×1920) / Card (1200×630) formats.
 */
export function ShareCard({ data, onClose }: { data: ShareCardData; onClose: () => void }) {
  const [format, setFormat] = useState<ShareFormat>("story");
  const [preview, setPreview] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let alive = true;
    setPreview(null);
    void drawShareCard(format, data).then((cv) => {
      if (!alive) return;
      canvasRef.current = cv;
      setPreview(cv.toDataURL("image/png"));
    });
    return () => { alive = false; };
  }, [format, data]);

  const toBlob = () => new Promise<Blob | null>((res) => {
    const cv = canvasRef.current;
    if (!cv) return res(null);
    cv.toBlob((b) => res(b), "image/png");
  });

  const download = async () => {
    const blob = await toBlob();
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `lifepatch-${data.runId}-${format}.png`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const share = async () => {
    const blob = await toBlob();
    if (!blob) return;
    const file = new File([blob], `lifepatch-${data.runId}.png`, { type: "image/png" });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.share && nav.canShare?.({ files: [file] })) {
      try {
        await nav.share({ files: [file], title: "LIFEPATCH", text: `My verdict: ${data.verdict}` });
        return;
      } catch { /* user cancelled or unsupported — fall through */ }
    }
    void download();
  };

  const aspect = FORMATS[format].w / FORMATS[format].h;

  return (
    <div className="fixed inset-0 z-[96] flex flex-col bg-bg text-ink" role="dialog" aria-modal="true" aria-label="Share your statement">
      <div className="flex items-stretch border-b border-hairline">
        <div className="flex items-center gap-2.5 px-4 py-3 sm:px-6">
          <span className="eyebrow text-ink" style={{ fontSize: "0.6rem", letterSpacing: "0.2em" }}>Statement</span>
          <span className="eyebrow text-secondary" style={{ fontSize: "0.55rem", letterSpacing: "0.22em" }}>/ Share</span>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="ml-auto flex items-center gap-1.5 border-l border-hairline px-4 py-3 text-ink-dim transition-colors hover:text-ink sm:px-6">
          <CloseIcon size={14} />
          <span className="eyebrow" style={{ fontSize: "0.56rem" }}>Close</span>
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-5 overflow-y-auto px-5 py-8">
        {/* format toggle */}
        <div className="flex items-stretch border border-hairline">
          {(["story", "og"] as ShareFormat[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFormat(f)}
              className={`display-caps px-4 py-2 text-[0.7rem] tracking-[0.12em] transition-colors ${format === f ? "bg-ink text-bg" : "bg-transparent text-ink-dim hover:text-ink"}`}
            >
              {f === "story" ? "Story 9:16" : "Card 1.91:1"}
            </button>
          ))}
        </div>

        {/* preview */}
        <div
          className="w-full max-w-[min(88vw,420px)] border border-hairline"
          style={{ aspectRatio: String(aspect), maxHeight: "58svh" }}
        >
          {preview ? (
            <img src={preview} alt="Share card preview" className="h-full w-full object-contain" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <span className="num text-[0.7rem] text-secondary">RENDERING…</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-stretch border-t border-hairline">
        <button type="button" onClick={share} disabled={!preview} className="group flex flex-1 items-center justify-center gap-2 border-r border-hairline py-4 text-ink transition-colors hover:bg-ink hover:text-bg disabled:opacity-40">
          <span className="display-caps text-[0.78rem] tracking-[0.14em]">[ Share ]</span>
        </button>
        <button type="button" onClick={download} disabled={!preview} className="flex flex-1 items-center justify-center gap-2 py-4 text-ink transition-colors hover:bg-ink hover:text-bg disabled:opacity-40">
          <span className="display-caps text-[0.78rem] tracking-[0.14em]">[ Download ]</span>
        </button>
      </div>
    </div>
  );
}
