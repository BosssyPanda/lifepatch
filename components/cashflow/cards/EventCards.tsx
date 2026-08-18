"use client";

import { HeartIcon, ScamIcon, VampireIcon } from "@/components/icons";
import { NeonButton } from "@/components/ui/LedgerButton";
import { LessonBox, Money, quoteText } from "@/components/cashflow/shared";
import { businessSaleOffer, charityCost, propertySaleOffer } from "@/lib/cashflow/engine";
import { CHARITY_STRATEGY_NOTE, EXPENSE_FREEDOM_NOTE } from "@/lib/cashflow/messages";
import { quote, totalExpenses } from "@/lib/cashflow/selectors";
import { currency } from "@/lib/format";
import type { CashflowState, DoodadCard as DoodadT, MarketCard as MarketT, SaleTerms } from "@/lib/cashflow/types";

export function DoodadCard({ card, cash, onPay }: { card: DoodadT; cash: number; onPay: () => void }) {
  const needLoan = cash < card.cost;
  return (
    <div className="panel">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center bg-loss text-bg">
          <VampireIcon size={22} />
        </span>
        <div>
          <p className="eyebrow text-loss" style={{ fontSize: "0.58rem" }}>
            Doodad — you must pay
          </p>
          <h3 className="display-caps text-xl text-ink">{card.label}</h3>
        </div>
        <span className="ml-auto num text-2xl font-bold text-loss">−{currency(card.cost)}</span>
      </div>
      <p className="voice mt-2 text-[0.86rem] text-ink/65">{card.flavor}</p>
      <LessonBox>{card.lesson}</LessonBox>
      {needLoan && (
        <p className="mt-3 bg-loss/12 px-3 py-2 font-body text-[0.8rem] text-loss">
          You only have {currency(cash)}. The bank will cover the rest — at 10%/month.
        </p>
      )}
      <div className="mt-4 flex justify-end">
        <NeonButton variant="paper" size="md" onClick={onPay}>
          Pay {currency(card.cost)}
        </NeonButton>
      </div>
    </div>
  );
}

export function CharityCard({ s, onDonate, onSkip }: { s: CashflowState; onDonate: () => void; onSkip: () => void }) {
  const cost = charityCost(s);
  return (
    <div className="panel">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center bg-tertiary text-bg">
          <HeartIcon size={22} />
        </span>
        <div>
          <p className="eyebrow text-secondary" style={{ fontSize: "0.58rem" }}>
            Charity
          </p>
          <h3 className="display-caps text-xl text-ink">Give back?</h3>
        </div>
      </div>
      <p className="mt-2 font-body text-[0.88rem] text-ink/80">
        Donate {currency(cost)} (10% of your income) and for the next 3 turns you may roll <strong>one or two</strong> dice — your choice. More control over where you land.
      </p>
      <LessonBox>{CHARITY_STRATEGY_NOTE}</LessonBox>
      <div className="mt-4 flex items-center justify-end gap-2">
        <NeonButton variant="outline" size="sm" onClick={onSkip}>
          Not now
        </NeonButton>
        <NeonButton variant="paper" size="md" onClick={onDonate}>
          Donate {currency(cost)}
        </NeonButton>
      </div>
    </div>
  );
}

/** One sellable line: what it fetches, what that nets, and whether it's a gain. */
function SaleRow({
  label,
  offer,
  debt,
  basis,
  onSell,
}: {
  label: string;
  offer: number;
  debt: number;
  basis: number;
  onSell: () => void;
}) {
  const net = offer - debt;
  const gain = offer - basis;
  const good = gain >= 0;
  return (
    <div className="flex items-center justify-between gap-2 bg-bg2 px-3 py-2">
      <div className="min-w-0">
        <p className="display-caps truncate text-[0.82rem] text-ink">{label}</p>
        <p className="font-body text-[0.72rem] text-ink/60">
          Offer {currency(offer)} · net cash <Money n={net} className={net >= 0 ? "text-gain" : "text-loss"} />
        </p>
        <p className={`num text-[0.7rem] ${good ? "text-gain" : "text-loss"}`}>
          {good ? "Capital gain +" : "Capital LOSS "}
          {currency(gain)} vs. the {currency(basis)} you paid
        </p>
      </div>
      <NeonButton variant={good ? "paper" : "outline"} size="sm" onClick={onSell}>
        Sell
      </NeonButton>
    </div>
  );
}

export function MarketCardView({
  card,
  s,
  onSellProperty,
  onSellBusiness,
  onSellStock,
  onWindfall,
  onDone,
}: {
  card: MarketT;
  s: CashflowState;
  onSellProperty: (uid: string, salePrice: number) => void;
  onSellBusiness: (uid: string, salePrice: number) => void;
  onSellStock: (symbol: string, shares: number) => void;
  onWindfall: (card: Extract<MarketT, { kind: "windfall" }>) => void;
  onDone: () => void;
}) {
  if (card.kind === "windfall") {
    const good = card.cash >= 0;
    return (
      <div className="panel">
        <p className="eyebrow text-secondary" style={{ fontSize: "0.58rem" }}>
          The Market
        </p>
        <h3 className="display-caps mt-1 text-xl text-ink">{card.title}</h3>
        <p className="voice mt-1 text-[0.86rem] text-ink/65">{card.flavor}</p>
        <p className={`mt-3 num text-3xl font-bold ${good ? "text-gain" : "text-loss"}`}>
          {good ? "+" : ""}
          {currency(card.cash)}
        </p>
        <LessonBox>{card.lesson}</LessonBox>
        <div className="mt-4 flex justify-end">
          <NeonButton variant="paper" size="md" onClick={() => onWindfall(card)}>
            {good ? "Collect" : "Pay it"}
          </NeonButton>
        </div>
      </div>
    );
  }

  // Both sale kinds carry the same `SaleTerms`; lift them once so the offer helper
  // is called with a narrowed value rather than a cast.
  const terms: SaleTerms =
    card.kind === "propertySale" || card.kind === "businessSale"
      ? { multiple: card.multiple, spread: card.spread }
      : { multiple: 1, spread: 0 };
  const properties = card.kind === "propertySale" ? s.realEstate.filter((h) => h.propertyType === card.propertyType) : [];
  const businesses = card.kind === "businessSale" ? s.businesses : [];
  const stocks = card.kind === "stockMarket" ? s.stocks : [];
  const count = properties.length + businesses.length + stocks.length;

  return (
    <div className="panel">
      <span className="grid h-10 w-10 place-items-center bg-ink text-bg">
        <ScamIcon size={22} />
      </span>
      <p className="mt-2 eyebrow text-secondary" style={{ fontSize: "0.58rem" }}>
        The Market
      </p>
      <h3 className="display-caps text-xl text-ink">{card.title}</h3>
      <p className="voice mt-1 text-[0.86rem] text-ink/65">{card.flavor}</p>
      <LessonBox>{card.lesson}</LessonBox>

      {card.kind === "stockMarket" && (
        /* The quote board moves whether or not you own anything — seeing it move
           is half the lesson for a stock that pays no dividend. */
        <div className="mt-3 bg-bg2 px-3 py-2">
          <p className="eyebrow text-secondary" style={{ fontSize: "0.54rem" }}>
            Quote board
          </p>
          <div className="mt-1 grid grid-cols-2 gap-x-4">
            {Object.entries(s.stockPrices ?? {}).map(([sym, px]) => (
              <div key={sym} className="flex items-baseline justify-between py-[1px]">
                <span className="num text-[0.74rem] text-ink/70">{sym}</span>
                <span className="num text-[0.74rem] text-ink">{quoteText(px)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {count === 0 ? (
        <p className="mt-3 font-body text-[0.84rem] text-ink/70">
          {card.kind === "stockMarket"
            ? "You hold no shares, so this one just moves prices. Watching a market you're not in is free education."
            : "You don't own a matching asset, so there's nothing to sell. Noted for next time."}
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {properties.map((h) => (
            <SaleRow
              key={h.uid}
              label={h.label}
              offer={propertySaleOffer(s, terms, h)}
              debt={h.mortgage}
              basis={h.price}
              onSell={() => onSellProperty(h.uid, propertySaleOffer(s, terms, h))}
            />
          ))}
          {businesses.map((h) => (
            <SaleRow
              key={h.uid}
              label={h.label}
              offer={businessSaleOffer(s, terms, h)}
              debt={h.liability}
              basis={h.price}
              onSell={() => onSellBusiness(h.uid, businessSaleOffer(s, terms, h))}
            />
          ))}
          {stocks.map((h) => {
            const px = quote(s, h.symbol, h.costBasis);
            return (
              <SaleRow
                key={h.uid}
                label={`${h.shares} × ${h.symbol} @ ${quoteText(px)}`}
                offer={Math.round(h.shares * px)}
                debt={0}
                basis={Math.round(h.shares * h.costBasis)}
                onSell={() => onSellStock(h.symbol, h.shares)}
              />
            );
          })}
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <NeonButton variant="outline" size="sm" onClick={onDone}>
          {count === 0 ? "Continue" : "Keep & continue"}
        </NeonButton>
      </div>
    </div>
  );
}

export function BabyCard({ s, onOk }: { s: CashflowState; onOk: () => void }) {
  const maxed = s.children >= 3;
  return (
    <div className="panel">
      <span className="grid h-10 w-10 place-items-center bg-secondary text-bg">
        <HeartIcon size={22} />
      </span>
      <h3 className="display-caps mt-2 text-xl text-ink">{maxed ? "A full house" : "It's a baby!"}</h3>
      <p className="mt-1 font-body text-[0.88rem] text-ink/80">
        {maxed
          ? "Your family is already full (3 kids). No new expense this time."
          : `Congratulations. Each child adds ${currency(s.perChild)}/month to your expenses.`}
      </p>
      <LessonBox>{EXPENSE_FREEDOM_NOTE}</LessonBox>
      <div className="mt-4 flex justify-end">
        <NeonButton variant="paper" size="md" onClick={onOk}>
          {maxed ? "Continue" : "Welcome the baby"}
        </NeonButton>
      </div>
    </div>
  );
}

export function DownsizedCard({ s, onOk }: { s: CashflowState; onOk: () => void }) {
  return (
    <div className="panel">
      <span className="grid h-10 w-10 place-items-center bg-loss text-bg">
        <ScamIcon size={22} />
      </span>
      <h3 className="display-caps mt-2 text-xl text-ink">Downsized</h3>
      <p className="mt-1 font-body text-[0.88rem] text-ink/80">
        You lost your job. Pay one full month of expenses ({currency(totalExpenses(s))}) and skip your next 2 turns.
      </p>
      <LessonBox>A salary can be taken away overnight. Passive income can&apos;t be laid off — that&apos;s the whole point of building assets.</LessonBox>
      <div className="mt-4 flex justify-end">
        <NeonButton variant="paper" size="md" onClick={onOk}>
          Take the hit
        </NeonButton>
      </div>
    </div>
  );
}
