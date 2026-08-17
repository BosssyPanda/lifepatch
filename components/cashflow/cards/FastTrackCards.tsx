"use client";

import { BankIcon } from "@/components/icons";
import { NeonButton } from "@/components/ui/LedgerButton";
import { getDream } from "@/lib/cashflow/dreams";
import { currency } from "@/lib/format";
import type { CashflowState, FastTrackDeal } from "@/lib/cashflow/types";

/**
 * The fast-track resolution cards. They take everything they render as props and hold no
 * game state, which is why they live here beside DealCard/EventCards rather than inside
 * CashflowGame — the screen only decides which one to mount.
 */

export function FtSimpleCard({ title, body, action, tone, onOk }: { title: string; body: string; action: string; tone?: "bad"; onOk: () => void }) {
  return (
    <div className="panel">
      <h3 className={`display-caps text-xl ${tone === "bad" ? "text-loss" : "text-ink"}`}>{title}</h3>
      <p className="mt-2 font-body text-[0.9rem] text-ink/80">{body}</p>
      <div className="mt-4 flex justify-end">
        <NeonButton variant="paper" size="md" onClick={onOk}>
          {action}
        </NeonButton>
      </div>
    </div>
  );
}

export function FtDealCard({ deal, cash, onBuy, onPass }: { deal: FastTrackDeal; cash: number; onBuy: () => void; onPass: () => void }) {
  const afford = cash >= deal.price;
  return (
    <div className="panel">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center bg-secondary text-bg">
          <BankIcon size={22} />
        </span>
        <div>
          <p className="eyebrow text-secondary" style={{ fontSize: "0.58rem" }}>
            Fast Track investment
          </p>
          <h3 className="display-caps text-xl text-ink">{deal.label}</h3>
        </div>
      </div>
      <p className="mt-2 voice text-[0.86rem] text-ink/65">{deal.flavor}</p>
      <div className="mt-3 flex items-center justify-between bg-bg2 px-3 py-2">
        <span className="font-body text-[0.84rem] text-ink/70">Price (cash)</span>
        <span className="num font-semibold text-ink">{currency(deal.price)}</span>
      </div>
      <div className="mt-1 flex items-center justify-between bg-gain/15 px-3 py-2">
        <span className="font-body text-[0.84rem] text-ink/70">Adds monthly cash flow</span>
        <span className="num font-bold text-gain">+{currency(deal.cashFlow)}</span>
      </div>
      {!afford && <p className="mt-3 font-body text-[0.82rem] text-loss">Not enough cash. Land on Cash Flow Days to build up, then return.</p>}
      <div className="mt-4 flex items-center justify-end gap-2">
        <NeonButton variant="outline" size="sm" onClick={onPass}>
          Pass
        </NeonButton>
        <NeonButton variant="paper" size="md" disabled={!afford} onClick={onBuy}>
          Buy · {currency(deal.price)}
        </NeonButton>
      </div>
    </div>
  );
}

export function FtDreamCard({ s, onBuy, onPass }: { s: CashflowState; onBuy: () => void; onPass: () => void }) {
  const dream = getDream(s.dreamId);
  const afford = s.cash >= dream.cost;
  return (
    <div className="panel">
      <p className="eyebrow text-ink" style={{ fontSize: "0.6rem" }}>
        Your Dream
      </p>
      <h3 className="display-caps mt-1 text-2xl text-ink">{dream.title}</h3>
      <p className="mt-1 font-body text-[0.9rem] text-ink/80">{dream.blurb}</p>
      <div className="mt-3 flex items-center justify-between bg-bg2 px-3 py-2">
        <span className="font-body text-[0.84rem] text-ink/70">Cost</span>
        <span className="num text-lg font-bold text-ink">{currency(dream.cost)}</span>
      </div>
      {!afford && <p className="mt-3 font-body text-[0.82rem] text-loss">You have {currency(s.cash)}. Keep building cash flow and come back to claim it.</p>}
      <div className="mt-4 flex items-center justify-end gap-2">
        <NeonButton variant="outline" size="sm" onClick={onPass}>
          Not yet
        </NeonButton>
        <NeonButton variant="paper" size="md" disabled={!afford} onClick={onBuy}>
          Claim my dream
        </NeonButton>
      </div>
    </div>
  );
}
