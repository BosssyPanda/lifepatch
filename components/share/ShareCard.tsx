"use client";

import { useEffect, useRef, useState } from "react";
import { CloseIcon } from "@/components/icons";
import { LedgerButton } from "@/components/ui/LedgerButton";
import { useDialog } from "@/components/ui/LedgerDialog";
import { LedgerTabs, tabId } from "@/components/ui/LedgerTabs";
import { TerminalOp } from "@/components/ui/TerminalOp";
import { drawShareCard, FORMATS, type ShareCardData, type ShareFormat } from "./drawShareCard";

/**
 * Share-card preview + export (Addendum A §7.2). Renders the palette-locked card to
 * an offscreen canvas on open, shows a preview, and offers Download (PNG) + Web Share
 * (with a download fallback). Story (1080×1920) / Card (1200×630) formats.
 */
/** Some browsers cancel an object-URL download if the URL is revoked in the same tick. */
const REVOKE_DELAY_MS = 60_000;

/** The native share sheet reports a user dismissal as one of these — not a failure to fall back from. */
function isUserCancel(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || err.name === "NotAllowedError");
}

const PANEL_ID = "share-preview";
const FORMAT_TABS = [
  { id: "story", label: "Story 9:16" },
  { id: "og", label: "Card 1.91:1" },
] as const satisfies readonly { id: ShareFormat; label: string }[];

export function ShareCard({ data, onClose }: { data: ShareCardData; onClose: () => void }) {
  const [format, setFormat] = useState<ShareFormat>("story");
  const [preview, setPreview] = useState<string | null>(null);
  const [drawFailed, setDrawFailed] = useState(false);
  const [redraw, setRedraw] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Focus trap / Escape / focus restore / scroll lock — it already claimed role="dialog".
  const dialogRef = useDialog<HTMLDivElement>({ open: true, onClose });

  useEffect(() => {
    let alive = true;
    setPreview(null);
    setDrawFailed(false);
    drawShareCard(format, data)
      .then((cv) => {
        if (!alive) return;
        canvasRef.current = cv;
        setPreview(cv.toDataURL("image/png"));
      })
      // Without this a failed render left "PRINTING STATEMENT…" up forever, both
      // buttons disabled, with no way to tell that anything had gone wrong.
      .catch(() => {
        if (!alive) return;
        canvasRef.current = null;
        setDrawFailed(true);
      });
    return () => { alive = false; };
  }, [format, data, redraw]);

  const toBlob = () => new Promise<Blob | null>((res) => {
    const cv = canvasRef.current;
    if (!cv) return res(null);
    cv.toBlob((b) => res(b), "image/png");
  });

  const download = async () => {
    const blob = await toBlob();
    if (!blob) return;
    const a = document.createElement("a");
    const href = URL.createObjectURL(blob);
    a.href = href;
    a.download = `lifepatch-${data.runId}-${format}.png`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(href), REVOKE_DELAY_MS);
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
      } catch (err) {
        // Dismissing the share sheet is a decision, not an error — downloading the
        // file anyway is the opposite of what the player just asked for.
        if (isUserCancel(err)) return;
      }
    }
    void download();
  };

  const aspect = FORMATS[format].w / FORMATS[format].h;

  return (
    <div ref={dialogRef} className="fixed inset-0 z-[96] flex flex-col bg-bg text-ink" role="dialog" aria-modal="true" aria-label="Share your statement">
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
        <LedgerTabs
          items={FORMAT_TABS}
          value={format}
          onChange={setFormat}
          label="Share card format"
          panelId={PANEL_ID}
          size="sm"
        />

        {/* preview */}
        <div
          id={PANEL_ID}
          role="tabpanel"
          aria-labelledby={tabId(PANEL_ID, format)}
          // the preview holds no focusable content, so the pane itself must take focus or
          // the keyboard cannot reach (or scroll) it from the format tabs
          tabIndex={0}
          className="w-full max-w-[min(88vw,420px)] border border-hairline"
          style={{ aspectRatio: String(aspect), maxHeight: "58svh" }}
        >
          {preview ? (
            <img src={preview} alt="Share card preview" className="h-full w-full object-contain" />
          ) : drawFailed ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-5 text-center" role="alert">
              <p className="display-caps text-[0.8rem] tracking-[0.14em] text-loss">Could not print the statement</p>
              <LedgerButton variant="secondary" size="sm" onClick={() => setRedraw((n) => n + 1)}>
                Try again
              </LedgerButton>
            </div>
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <TerminalOp label="Printing statement" center />
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
