"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import { ApartmentIcon, FactoryIcon, MarketIcon } from "@/components/icons";
import { NeonButton } from "@/components/ui/LedgerButton";
import { LessonBox, Money, quoteText } from "@/components/cashflow/shared";
import { cashOnCash, dividendYield, maxAffordable } from "@/lib/cashflow/selectors";
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
    <div className="paper p-5">
      <p className="eyebrow text-ink" style={{ fontSize: "0.6rem" }}>
        Opportunity
      </p>
      <h3 className="display-caps mt-1 text-2xl text-ink">Which deal?</h3>
      <p className="mt-1 font-body text-[0.9rem] text-ink/75">
        Small deals are cheap and frequent. Big deals cost more but can move you toward freedom in one move.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <motion.button
          whileHover={{ y: -3 }}
          onClick={() => onPick("small")}
          data-radius=""
          className="border-2 border-hairline-strong bg-bg2 p-4 text-left hover:border-ink"
        >
          <span className="display-caps text-lg text-ink">Small Deal</span>
          <p className="mt-1 font-body text-[0.8rem] text-ink/70">Stocks & small properties. Low cash to enter.</p>
        </motion.button>
        <motion.button
          whileHover={{ y: -3 }}
          onClick={() => onPick("big")}
          data-radius=""
          className="border-2 border-hairline-strong bg-bg2 p-4 text-left hover:border-ink"
        >
          <span className="display-caps text-lg text-ink">Big Deal</span>
          <p className="mt-1 font-body text-[0.8rem] text-ink/70">Apartments & businesses. Big cash flow, big ticket.</p>
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

/**
 * The share stepper's ± keys stay visually 28px (the row has to fit beside the count and
 * MAX at 390px) and buy the 44px target with an invisible `::before` layer — the same
 * trick `LedgerButton`'s `HIT` map uses, expanded on both axes rather than just vertically.
 */
const STEP_HIT =
  "relative grid h-7 w-7 place-items-center bg-ink text-bg before:absolute before:-inset-2 before:content-['']";

function StatLine({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="flex items-center justify-between border-b border-ink/10 py-1.5 last:border-0">
      <span className="font-body text-[0.84rem] text-ink/70">{label}</span>
      <span className={`num text-[0.92rem] font-semibold ${tone === "good" ? "text-gain" : tone === "bad" ? "text-loss" : "text-ink"}`}>
        {value}
      </span>
    </div>
  );
}

export function DealCard({
  deal,
  cash,
  price,
  canAfford = true,
  onBuy,
  onPass,
}: {
  deal: Deal;
  cash: number;
  /** Live quote for a stock deal. Stocks are no longer priced at their deck value
   *  forever, so the card has to ask for the same number the engine will charge. */
  price?: number;
  /**
   * Whether the engine will actually accept this purchase — `canAffordDeal(s, down)`,
   * answered by the engine rather than re-derived here.
   *
   * It has to be the engine's answer and not a `cash < down` test in the UI, because
   * "can I afford it" means "cash plus what the bank will lend, quantised to the
   * thousand it lends in". A card that reasons about that separately drifts from the
   * rule that decides the outcome, which is how this card came to promise the bank
   * would cover a gap the bank had already refused.
   */
  canAfford?: boolean;
  onBuy: (shares?: number) => void;
  onPass: () => void;
}) {
  const Icon = deal.kind === "stock" ? MarketIcon : deal.kind === "business" ? FactoryIcon : ApartmentIcon;

  if (deal.kind === "stock") {
    return <StockDealView deal={deal} cash={cash} price={price ?? deal.price} onBuy={onBuy} onPass={onPass} Icon={Icon} />;
  }

  // real estate / business share the same shape
  const down = deal.downPayment;
  const cashFlow = deal.cashFlow;
  const coc = cashOnCash(cashFlow * 12, down);
  const needLoan = cash < down;

  return (
    <div className="paper p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 place-items-center bg-ink text-bg">
          <Icon size={22} />
        </span>
        <div>
          <p className="eyebrow text-secondary" style={{ fontSize: "0.58rem" }}>
            {deal.kind === "business" ? "Business deal" : "Real-estate deal"}
          </p>
          <h3 className="display-caps text-xl text-ink">{deal.label}</h3>
        </div>
      </div>

      <div className="mt-3 bg-bg2 px-3 py-1.5">
        <StatLine label="Price" value={currency(deal.price)} />
        <StatLine label="Down payment (cash needed)" value={currency(down)} />
        {"mortgage" in deal && deal.mortgage > 0 && <StatLine label="Mortgage taken on" value={currency(deal.mortgage)} />}
        {"liability" in deal && deal.liability > 0 && <StatLine label="Loan taken on" value={currency(deal.liability)} />}
        <StatLine label="Monthly cash flow" value={`${cashFlow >= 0 ? "+" : ""}${currency(cashFlow)}`} tone={cashFlow > 0 ? "good" : cashFlow < 0 ? "bad" : undefined} />
        <StatLine label="Cash-on-cash return" value={`${coc.toFixed(0)}%/yr`} tone={coc >= 20 ? "good" : undefined} />
      </div>

      <LessonBox>{deal.lesson}</LessonBox>

      {/* Two different messages, because they are two different situations and the
          card used to print the reassuring one for both. "The bank will cover the
          gap" was shown whenever cash was short — including when the credit line was
          already exhausted and the click would end the run on the spot. */}
      {needLoan && canAfford && (
        <p className="mt-3 bg-loss/12 px-3 py-2 font-body text-[0.8rem] text-loss">
          You have {currency(cash)}. Buying means a bank loan to cover the gap — at 10%/month. Borrow wisely.
        </p>
      )}
      {!canAfford && (
        <p className="mt-3 bg-loss/12 px-3 py-2 font-body text-[0.8rem] text-loss">
          You have {currency(cash)}, and the bank will not lend the rest. This one is out of reach
          — pass, and come back when your cash flow has bought you the room.
        </p>
      )}

      <div className="mt-4 flex items-center justify-end gap-2">
        <NeonButton variant="outline" size="sm" onClick={onPass}>
          Pass
        </NeonButton>
        <NeonButton variant="paper" size="md" disabled={!canAfford} onClick={() => onBuy()}>
          Buy · {currency(down)} down
        </NeonButton>
      </div>
    </div>
  );
}

function StockDealView({
  deal,
  cash,
  price,
  onBuy,
  onPass,
  Icon,
}: {
  deal: StockDeal;
  cash: number;
  price: number;
  onBuy: (shares?: number) => void;
  onPass: () => void;
  Icon: (p: { size?: number }) => React.ReactElement;
}) {
  const maxShares = maxAffordable(cash, price);
  const [shares, setShares] = useState(Math.min(100, maxShares));
  const cost = shares * price;
  const monthly = shares * deal.dividend;
  const yld = dividendYield(deal.dividend, price);

  return (
    <div className="paper p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 place-items-center bg-ink text-bg">
          <Icon size={22} />
        </span>
        <div>
          <p className="eyebrow text-secondary" style={{ fontSize: "0.58rem" }}>
            Stock · {deal.symbol}
          </p>
          <h3 className="display-caps text-xl text-ink">{deal.name}</h3>
        </div>
        <span className="ml-auto num text-lg font-bold text-ink">{quoteText(price)}<span className="text-[0.7rem] text-ink/50">/sh</span></span>
      </div>

      <div className="mt-3 bg-bg2 px-3 py-1.5">
        <StatLine label="Dividend" value={deal.dividend > 0 ? `${quoteText(deal.dividend)}/sh/mo` : "none"} tone={deal.dividend > 0 ? "good" : undefined} />
        <StatLine label="Dividend yield" value={`${yld.toFixed(0)}%/yr`} />
        <StatLine label="Typical range" value={`${quoteText(deal.range[0])} – ${quoteText(deal.range[1])}`} />
        {/* No tone. Green and red are money, and only money (DESIGN.md § Palette) — a
            quote sitting under its usual range is a CONDITION, not a gain, and painting
            it green made the card recommend the trade. Until commit 4 clamped the price
            walk it was worse than a recommendation: a stock at its floor could not lose,
            and this line advertised the fact. "Above" / "Below" and the `Typical range`
            row directly above carry the whole meaning with no hue at all. */}
        <StatLine
          label={price > deal.price ? "Above its usual price" : price < deal.price ? "Below its usual price" : "At its usual price"}
          value={`${price >= deal.price ? "+" : "−"}${Math.abs(Math.round(((price - deal.price) / deal.price) * 100))}%`}
        />
      </div>

      <LessonBox>{deal.lesson}</LessonBox>

      {maxShares > 0 ? (
        <>
          <div className="mt-4 flex items-center justify-between gap-3">
            <span className="font-body text-[0.84rem] text-ink/70">Shares</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShares((n) => Math.max(0, n - 10))}
                disabled={shares <= 0}
                aria-label="Ten fewer shares"
                className={`${STEP_HIT} disabled:opacity-40`}
              >
                −
              </button>
              {/* A spinbutton, not a bare number: the count is the only thing a press
                  changes, and this makes screen readers announce the new value without
                  a live region wrapping the buttons that caused it. */}
              <span
                role="spinbutton"
                tabIndex={0}
                aria-label="Shares"
                aria-valuenow={shares}
                aria-valuemin={0}
                aria-valuemax={maxShares}
                aria-valuetext={`${shares} shares`}
                onKeyDown={(e) => {
                  const d = e.key === "ArrowUp" || e.key === "ArrowRight" ? 10 : e.key === "ArrowDown" || e.key === "ArrowLeft" ? -10 : 0;
                  if (!d) return;
                  e.preventDefault();
                  setShares((n) => Math.min(maxShares, Math.max(0, n + d)));
                }}
                className="num w-14 text-center text-lg font-bold text-ink"
              >
                {shares}
              </span>
              <button
                type="button"
                onClick={() => setShares((n) => Math.min(maxShares, n + 10))}
                disabled={shares >= maxShares}
                aria-label="Ten more shares"
                className={`${STEP_HIT} disabled:opacity-40`}
              >
                +
              </button>
              <button
                type="button"
                onClick={() => setShares(maxShares)}
                /* Not "Buy the maximum number of shares": this control does not buy
                   anything, it only sets the stepper. The old name also collided with
                   the real Buy button under any by-role lookup for /^buy/ — the MAX
                   button comes first in the DOM, so automation (and anyone navigating
                   by accessible name) hit the stepper instead of the purchase, and the
                   card became impossible to dismiss. WCAG 2.5.3: the visible "MAX" is
                   still the start of the accessible name. */
                aria-label="Max shares affordable"
                className="relative ml-1 border border-hairline-strong px-2 py-1 num text-[0.7rem] text-ink/70 before:absolute before:-inset-x-1 before:-inset-y-[11px] before:content-['']"
              >
                MAX
              </button>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between font-body text-[0.82rem] text-ink/70">
            <span>Cost <Money n={cost} className="text-ink" /></span>
            <span>Income <Money n={monthly} className="text-gain" />/mo</span>
          </div>
        </>
      ) : (
        <p className="mt-3 font-body text-[0.82rem] text-loss">Not enough cash to buy a single share. Build up cash first.</p>
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
