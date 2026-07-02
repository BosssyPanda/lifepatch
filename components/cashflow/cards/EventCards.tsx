"use client";

import { HeartIcon, ScamIcon, VampireIcon } from "@/components/icons";
import { NeonButton } from "@/components/ui/NeonButton";
import { LessonBox, Money } from "@/components/cashflow/shared";
import { businessSalePrice, charityCost } from "@/lib/cashflow/engine";
import { CHARITY_STRATEGY_NOTE, EXPENSE_FREEDOM_NOTE } from "@/lib/cashflow/messages";
import { totalExpenses } from "@/lib/cashflow/selectors";
import { currency } from "@/lib/format";
import type { CashflowState, DoodadCard as DoodadT, MarketCard as MarketT } from "@/lib/cashflow/types";

const PANEL = "paper rounded-[6px] p-5";

export function DoodadCard({ card, cash, onPay }: { card: DoodadT; cash: number; onPay: () => void }) {
  const needLoan = cash < card.cost;
  return (
    <div className={PANEL}>
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-[5px] bg-loss text-bg">
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
      <p className="mt-2 font-body text-[0.86rem] italic text-ink/65">{card.flavor}</p>
      <LessonBox>{card.lesson}</LessonBox>
      {needLoan && (
        <p className="mt-3 rounded-[4px] bg-loss/12 px-3 py-2 font-body text-[0.8rem] text-loss">
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
    <div className={PANEL}>
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-[5px] bg-tertiary text-bg">
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

export function MarketCardView({
  card,
  s,
  onSellProperty,
  onSellBusiness,
  onWindfall,
  onDone,
}: {
  card: MarketT;
  s: CashflowState;
  onSellProperty: (uid: string, salePrice: number) => void;
  onSellBusiness: (uid: string) => void;
  onWindfall: (card: Extract<MarketT, { kind: "windfall" }>) => void;
  onDone: () => void;
}) {
  if (card.kind === "windfall") {
    const good = card.cash >= 0;
    return (
      <div className={PANEL}>
        <p className="eyebrow text-secondary" style={{ fontSize: "0.58rem" }}>
          The Market
        </p>
        <h3 className="display-caps mt-1 text-xl text-ink">{card.title}</h3>
        <p className="mt-1 font-body text-[0.86rem] italic text-ink/65">{card.flavor}</p>
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

  const matches =
    card.kind === "propertySale"
      ? s.realEstate.filter((h) => h.propertyType === card.propertyType)
      : s.businesses;

  return (
    <div className={PANEL}>
      <span className="grid h-10 w-10 place-items-center rounded-[5px] bg-ink text-bg">
        <ScamIcon size={22} />
      </span>
      <p className="mt-2 eyebrow text-secondary" style={{ fontSize: "0.58rem" }}>
        The Market
      </p>
      <h3 className="display-caps text-xl text-ink">{card.title}</h3>
      <p className="mt-1 font-body text-[0.86rem] italic text-ink/65">{card.flavor}</p>
      <LessonBox>{card.lesson}</LessonBox>

      {matches.length === 0 ? (
        <p className="mt-3 font-body text-[0.84rem] text-ink/70">
          You don&apos;t own a matching asset, so there&apos;s nothing to sell. Noted for next time.
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {card.kind === "propertySale"
            ? s.realEstate
                .filter((h) => h.propertyType === card.propertyType)
                .map((h) => {
                  const net = card.salePrice - h.mortgage;
                  const gain = card.salePrice - h.price;
                  return (
                    <div key={h.uid} className="flex items-center justify-between rounded-[4px] bg-bg2 px-3 py-2">
                      <div>
                        <p className="display-caps text-[0.82rem] text-ink">{h.label}</p>
                        <p className="font-body text-[0.72rem] text-ink/60">
                          Net cash <Money n={net} className="text-gain" /> · gain {gain >= 0 ? "+" : ""}
                          {currency(gain)}
                        </p>
                      </div>
                      <NeonButton variant="paper" size="sm" onClick={() => onSellProperty(h.uid, card.salePrice)}>
                        Sell
                      </NeonButton>
                    </div>
                  );
                })
            : s.businesses.map((h) => {
                const sale = businessSalePrice(h.price);
                const net = sale - h.liability;
                return (
                  <div key={h.uid} className="flex items-center justify-between rounded-[4px] bg-bg2 px-3 py-2">
                    <div>
                      <p className="display-caps text-[0.82rem] text-ink">{h.label}</p>
                      <p className="font-body text-[0.72rem] text-ink/60">
                        Sells for {currency(sale)} · net <Money n={net} className="text-gain" />
                      </p>
                    </div>
                    <NeonButton variant="paper" size="sm" onClick={() => onSellBusiness(h.uid)}>
                      Sell
                    </NeonButton>
                  </div>
                );
              })}
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <NeonButton variant="outline" size="sm" onClick={onDone}>
          {matches.length === 0 ? "Continue" : "Keep & continue"}
        </NeonButton>
      </div>
    </div>
  );
}

export function BabyCard({ s, onOk }: { s: CashflowState; onOk: () => void }) {
  const maxed = s.children >= 3;
  return (
    <div className={PANEL}>
      <span className="grid h-10 w-10 place-items-center rounded-[5px] bg-secondary text-bg">
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
    <div className={PANEL}>
      <span className="grid h-10 w-10 place-items-center rounded-[5px] bg-loss text-bg">
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
