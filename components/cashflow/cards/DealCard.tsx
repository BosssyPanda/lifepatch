"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import { ApartmentIcon, FactoryIcon, MarketIcon } from "@/components/icons";
import { NeonButton } from "@/components/ui/NeonButton";
import { LessonBox, Money } from "@/components/cashflow/shared";
import { cashOnCash, dividendYield } from "@/lib/cashflow/selectors";
import { currency } from "@/lib/format";
import type { Deal, StockDeal } from "@/lib/cashflow/types";

export function DealChooser({
  onPick,
  onPass,
}: {
  onPick: (size: "small" | "big") => void;
  onPass: () => void;
}) {
  return (
    <div className="paper rounded-[6px] p-5">
      <p className="eyebrow text-accent" style={{ fontSize: "0.6rem" }}>
        Opportunity
      </p>
      <h3 className="display-caps mt-1 text-2xl text-paper-ink">Which deal?</h3>
      <p className="mt-1 font-serif text-[0.9rem] text-paper-ink/75">
        Small deals are cheap and frequent. Big deals cost more but can move you toward freedom in one move.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <motion.button
          whileHover={{ y: -3 }}
          onClick={() => onPick("small")}
          className="rounded-[5px] border-2 border-paper-ink/30 bg-paper-2 p-4 text-left hover:border-accent"
        >
          <span className="display-caps text-lg text-paper-ink">Small Deal</span>
          <p className="mt-1 font-serif text-[0.8rem] text-paper-ink/70">Stocks & small properties. Low cash to enter.</p>
        </motion.button>
        <motion.button
          whileHover={{ y: -3 }}
          onClick={() => onPick("big")}
          className="rounded-[5px] border-2 border-paper-ink/30 bg-paper-2 p-4 text-left hover:border-accent"
        >
          <span className="display-caps text-lg text-paper-ink">Big Deal</span>
          <p className="mt-1 font-serif text-[0.8rem] text-paper-ink/70">Apartments & businesses. Big cash flow, big ticket.</p>
        </motion.button>
      </div>
      <div className="mt-4 flex justify-end">
        <NeonButton variant="outline" size="sm" onClick={onPass}>
          Skip this opportunity
        </NeonButton>
      </div>
    </div>
  );
}

function StatLine({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="flex items-center justify-between border-b border-paper-ink/10 py-1.5 last:border-0">
      <span className="font-serif text-[0.84rem] text-paper-ink/70">{label}</span>
      <span className={`num text-[0.92rem] font-semibold ${tone === "good" ? "text-olive" : tone === "bad" ? "text-brick" : "text-paper-ink"}`}>
        {value}
      </span>
    </div>
  );
}

export function DealCard({
  deal,
  cash,
  onBuy,
  onPass,
}: {
  deal: Deal;
  cash: number;
  onBuy: (shares?: number) => void;
  onPass: () => void;
}) {
  const Icon = deal.kind === "stock" ? MarketIcon : deal.kind === "business" ? FactoryIcon : ApartmentIcon;

  if (deal.kind === "stock") {
    return <StockDealView deal={deal} cash={cash} onBuy={onBuy} onPass={onPass} Icon={Icon} />;
  }

  // real estate / business share the same shape
  const down = deal.downPayment;
  const cashFlow = deal.cashFlow;
  const coc = cashOnCash(cashFlow * 12, down);
  const needLoan = cash < down;

  return (
    <div className="paper rounded-[6px] p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-[5px] bg-paper-ink text-paper">
          <Icon size={22} />
        </span>
        <div>
          <p className="eyebrow text-paper-dim" style={{ fontSize: "0.58rem" }}>
            {deal.kind === "business" ? "Business deal" : "Real-estate deal"}
          </p>
          <h3 className="display-caps text-xl text-paper-ink">{deal.label}</h3>
        </div>
      </div>

      <div className="mt-3 rounded-[5px] bg-paper-2 px-3 py-1.5">
        <StatLine label="Price" value={currency(deal.price)} />
        <StatLine label="Down payment (cash needed)" value={currency(down)} />
        {"mortgage" in deal && deal.mortgage > 0 && <StatLine label="Mortgage taken on" value={currency(deal.mortgage)} />}
        {"liability" in deal && deal.liability > 0 && <StatLine label="Loan taken on" value={currency(deal.liability)} />}
        <StatLine label="Monthly cash flow" value={`${cashFlow >= 0 ? "+" : ""}${currency(cashFlow)}`} tone={cashFlow > 0 ? "good" : cashFlow < 0 ? "bad" : undefined} />
        <StatLine label="Cash-on-cash return" value={`${coc.toFixed(0)}%/yr`} tone={coc >= 20 ? "good" : undefined} />
      </div>

      <LessonBox>{deal.lesson}</LessonBox>

      {needLoan && (
        <p className="mt-3 rounded-[4px] bg-brick/12 px-3 py-2 font-serif text-[0.8rem] text-brick">
          You have {currency(cash)}. Buying means a bank loan to cover the gap — at 10%/month. Borrow wisely.
        </p>
      )}

      <div className="mt-4 flex items-center justify-end gap-2">
        <NeonButton variant="outline" size="sm" onClick={onPass}>
          Pass
        </NeonButton>
        <NeonButton variant="paper" size="md" onClick={() => onBuy()}>
          Buy · {currency(down)} down
        </NeonButton>
      </div>
    </div>
  );
}

function StockDealView({
  deal,
  cash,
  onBuy,
  onPass,
  Icon,
}: {
  deal: StockDeal;
  cash: number;
  onBuy: (shares?: number) => void;
  onPass: () => void;
  Icon: (p: { size?: number }) => React.ReactElement;
}) {
  const maxShares = Math.max(0, Math.floor(cash / deal.price));
  const [shares, setShares] = useState(Math.min(100, maxShares));
  const cost = shares * deal.price;
  const monthly = shares * deal.dividend;
  const yld = dividendYield(deal.dividend, deal.price);

  return (
    <div className="paper rounded-[6px] p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-[5px] bg-paper-ink text-paper">
          <Icon size={22} />
        </span>
        <div>
          <p className="eyebrow text-paper-dim" style={{ fontSize: "0.58rem" }}>
            Stock · {deal.symbol}
          </p>
          <h3 className="display-caps text-xl text-paper-ink">{deal.name}</h3>
        </div>
        <span className="ml-auto num text-lg font-bold text-paper-ink">{currency(deal.price)}<span className="text-[0.7rem] text-paper-ink/50">/sh</span></span>
      </div>

      <div className="mt-3 rounded-[5px] bg-paper-2 px-3 py-1.5">
        <StatLine label="Dividend" value={deal.dividend > 0 ? `${currency(deal.dividend)}/sh/mo` : "none"} tone={deal.dividend > 0 ? "good" : undefined} />
        <StatLine label="Dividend yield" value={`${yld.toFixed(0)}%/yr`} />
        <StatLine label="Typical range" value={`${currency(deal.range[0])} – ${currency(deal.range[1])}`} />
      </div>

      <LessonBox>{deal.lesson}</LessonBox>

      {maxShares > 0 ? (
        <>
          <div className="mt-4 flex items-center justify-between gap-3">
            <span className="font-serif text-[0.84rem] text-paper-ink/70">Shares</span>
            <div className="flex items-center gap-2">
              <button onClick={() => setShares((n) => Math.max(0, n - 10))} className="grid h-7 w-7 place-items-center rounded-[4px] bg-paper-ink text-paper">−</button>
              <span className="num w-14 text-center text-lg font-bold text-paper-ink">{shares}</span>
              <button onClick={() => setShares((n) => Math.min(maxShares, n + 10))} className="grid h-7 w-7 place-items-center rounded-[4px] bg-paper-ink text-paper">+</button>
              <button onClick={() => setShares(maxShares)} className="ml-1 rounded-[4px] border border-paper-ink/30 px-2 py-1 num text-[0.7rem] text-paper-ink/70">MAX</button>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between font-serif text-[0.82rem] text-paper-ink/70">
            <span>Cost <Money n={cost} className="text-paper-ink" /></span>
            <span>Income <Money n={monthly} className="text-olive" />/mo</span>
          </div>
        </>
      ) : (
        <p className="mt-3 font-serif text-[0.82rem] text-brick">Not enough cash to buy a single share. Build up cash first.</p>
      )}

      <div className="mt-4 flex items-center justify-end gap-2">
        <NeonButton variant="outline" size="sm" onClick={onPass}>
          Pass
        </NeonButton>
        <NeonButton variant="paper" size="md" disabled={shares <= 0} onClick={() => onBuy(shares)}>
          Buy {shares} · {currency(cost)}
        </NeonButton>
      </div>
    </div>
  );
}
