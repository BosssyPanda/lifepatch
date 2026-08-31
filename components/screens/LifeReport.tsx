"use client";

import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { AnnotatedLifeChart } from "@/components/share/AnnotatedLifeChart";
import { ShareCard } from "@/components/share/ShareCard";
import { useShareUrl } from "@/components/share/useShareUrl";
import { ApartmentIcon, BrainIcon, CashIcon, DebtIcon, ReplayIcon, SkullIcon, TrophyIcon } from "@/components/icons";
import { NeonButton } from "@/components/ui/LedgerButton";
import { SoundCell } from "@/components/ui/SoundCell";
import { LedgerRow, SectionLabel } from "@/components/ui/report";
import { MoneyBrainMeter, moneyBrainPct } from "@/components/learn/MoneyBrainMeter";
import { PersonalBestRow } from "@/components/social/PersonalBestRow";
import { useAudio } from "@/hooks/useAudio";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { useConceptLearn } from "@/hooks/useConceptLearn";
import { resolveProgressId } from "@/lib/cloud/identity";
import { conceptTitle } from "@/lib/concepts";
import { ASSETS } from "@/lib/assets";
import { currency } from "@/lib/format";
import { macroEvent } from "@/lib/markets";
import { DEBT_RATE, TAKE_HOME } from "@/lib/economy";
import { dailyShare, GRID_ROW, gridGlyph, gridSummary } from "@/lib/dailyShare";
import { ghostFor, GHOST_BUFFER_MONTHS } from "@/lib/replay";
import { annualExpenses, homeEquity, netWorth, operatingCashFlow, type RunState } from "@/lib/runEngine";
import { deriveVerdict } from "@/lib/verdict";
import { eventTeachesAny } from "@/lib/eventConcepts";
import { rankWeakSpots, readTallies, type WeakSpot } from "@/lib/weakSpots";
import { STAGGER } from "@/src/motion/tokens";

const container = { hidden: {}, show: { transition: { staggerChildren: STAGGER.list, delayChildren: STAGGER.loose } } };
const item = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } };

const REASON: Record<string, { label: string; Icon: typeof TrophyIcon }> = {
  "story-complete": { label: "The story ends", Icon: TrophyIcon },
  retired: { label: "You retired", Icon: TrophyIcon },
  quit: { label: "You walked away", Icon: TrophyIcon },
  died: { label: "Your number came up", Icon: SkullIcon },
  // The life sim's insolvency ending. Same register as the Rat Race lose screen:
  // it states what happened, it does not scold.
  insolvent: { label: "The debt won", Icon: DebtIcon },
};

/**
 * The closing statement for a run the engine ended as unrecoverable.
 *
 * Deliberately the same shape as `components/cashflow/recap/CashflowReport`'s lose
 * screen — years survived, what the interest consumed, the concept named — rather
 * than a second visual language for the same idea. The two modes teach one lesson
 * and they now print it on the same stationery.
 */
function ClosingStatement({ run }: { run: RunState }) {
  const years = run.history.length;
  const lastInterest = Math.round(run.debt * DEBT_RATE);
  const shortfall = Math.abs(operatingCashFlow(run));
  return (
    <motion.div variants={item} className="mt-8 border-t border-hairline pt-4">
      <p className="eyebrow text-loss" style={{ fontSize: "0.58rem" }}>
        The concept: the debt spiral
      </p>
      <div className="mt-3">
        <LedgerRow label="Years survived" value={String(years)} />
        <LedgerRow label="Interest the balance charged" value={currency(Math.round(run.interestPaid))} tone="text-loss" />
        <LedgerRow label="Balance at the end" value={currency(run.debt)} tone="text-loss" />
        <LedgerRow label="…which cost you this year alone" value={currency(lastInterest)} tone="text-loss" />
        <LedgerRow label="A year of this life cost" value={currency(annualExpenses(run))} />
        <LedgerRow label="…and the job brought home" value={currency(Math.round(run.salary * TAKE_HOME))} />
      </div>
      <p className="voice mt-4 text-[1.15rem] leading-snug text-ink">
        A year of living outran the paycheque by {currency(shortfall)}, and the shortfall became debt. Debt charges
        7% a year, so the next year started {currency(lastInterest)} further behind — and that gap is itself an
        expense, which made the next shortfall bigger. With nothing left to sell, no choice on the board could
        close it. Interest compounds against you exactly as fast as savings compound for you.
      </p>
      <p className="voice mt-3 text-[1.05rem] leading-snug text-ink/75">
        The way out was never one good year. It was killing the balance while it was still small, or getting the
        cost of a year below what the job pays — the two levers that shrink the gap instead of feeding it.
      </p>
    </motion.div>
  );
}

/**
 * Where the money ended up — assets AND what is owed against them.
 *
 * The shares used to divide by the listed assets alone, so a player holding
 * $10k of cash against $2M of debt read "Cash — 100%" and a full bar. Percentages
 * are of GROSS assets, and the liabilities are printed underneath as their own
 * share of that same base: owing more than you own shows as a bar past 100%,
 * because that is what it is. The closing line is the number that actually counts.
 */
function PortfolioBreakdown({ run }: { run: RunState }) {
  const assetRows = [
    ...ASSETS.map((a) => ({ key: a.id, label: a.short, Icon: a.Icon, value: run.holdings[a.id] ?? 0 })),
    { key: "cash", label: "Cash", Icon: CashIcon, value: run.cash },
    { key: "home", label: "Home", Icon: ApartmentIcon, value: run.homeValue },
  ]
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);

  const gross = assetRows.reduce((t, r) => t + r.value, 0);
  const owed = run.debt + run.mortgage;
  const nw = netWorth(run);

  // The header above is the question, so the panel always answers it — even with nothing left.
  if (assetRows.length === 0 && owed === 0) {
    return (
      <div className="border border-hairline bg-bg2 p-4">
        <LedgerRow label="Nothing left" value={currency(0)} />
      </div>
    );
  }

  const liabilities = [
    { key: "mortgage", label: "Mortgage", value: run.mortgage },
    { key: "debt", label: "Debt", value: run.debt },
  ].filter((r) => r.value > 0);

  // With no assets at all, a share of gross is a divide-by-zero; show the bar full instead.
  const share = (v: number) => (gross > 0 ? (v / gross) * 100 : 100);

  return (
    <div className="border border-hairline bg-bg2 p-4">
      <ul className="space-y-2">
        {assetRows.map((r) => {
          const pct = share(r.value);
          const Icon = r.Icon;
          return (
            <li key={r.key} className="flex items-center gap-2.5">
              <Icon size={15} className="shrink-0 text-secondary" />
              <span className="w-20 shrink-0 truncate font-mono text-[0.72rem] font-semibold uppercase tracking-wide text-ink/85">{r.label}</span>
              <div className="h-2 flex-1 overflow-hidden bg-hairline">
                <div className="h-full bg-ink" style={{ width: `${Math.max(2, pct)}%` }} />
              </div>
              <span className="num w-20 shrink-0 text-right text-sm text-ink">{currency(r.value)}</span>
              <span className="num w-9 shrink-0 text-right text-[0.7rem] text-secondary">{pct.toFixed(0)}%</span>
            </li>
          );
        })}
      </ul>

      {liabilities.length > 0 && (
        <ul className="mt-3 space-y-2 border-t border-hairline pt-3">
          {liabilities.map((r) => {
            const pct = share(r.value);
            return (
              <li key={r.key} className="flex items-center gap-2.5">
                <DebtIcon size={15} className="shrink-0 text-loss" />
                <span className="w-20 shrink-0 truncate font-mono text-[0.72rem] font-semibold uppercase tracking-wide text-loss">{r.label}</span>
                <div className="h-2 flex-1 overflow-hidden bg-hairline">
                  <div className="h-full bg-loss" style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
                </div>
                <span className="num w-20 shrink-0 text-right text-sm text-loss">−{currency(r.value)}</span>
                <span className="num w-9 shrink-0 text-right text-[0.7rem] text-loss">{pct.toFixed(0)}%</span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 border-t border-hairline pt-3">
        <LedgerRow label="Net worth" value={currency(nw)} strong />
      </div>
    </div>
  );
}

export function LifeReport({ run, onReplay, onTitle, onAlmanac, onMasteryMap, onBackToStandings }: { run: RunState; onReplay: () => void; onTitle: () => void; onAlmanac: () => void; onMasteryMap: () => void;
  /** Set only while this run's room is still open: the mirror of the podium's
   *  "See your life report", so reading your own statement isn't a one-way door
   *  out of the standings you were watching. Both other exits leave the room. */
  onBackToStandings?: () => void }) {
  const { mastery } = useProfile();
  const { runGains } = useConceptLearn();
  const { user } = useAuth();
  /**
   * What keeps going wrong, read after mount.
   *
   * The tallies are localStorage, which the server cannot see, and every one of
   * this run's own outcomes has already been written into them by the time the
   * report exists — so this is the state INCLUDING the life just finished, which is
   * what makes the sentence about the next run true.
   */
  const [weakSpots, setWeakSpots] = useState<WeakSpot[]>([]);
  useEffect(() => {
    setWeakSpots(rankWeakSpots(readTallies(resolveProgressId(user?.id ?? null))));
  }, [user]);
  /**
   * How many of this run's cards were actually about a weak spot — counted, not
   * claimed. The bias makes those cards LIKELIER; it does not guarantee one was
   * ever dealt, so the sentence below states the deck's weighting (true by
   * construction) and only quotes a figure when the journal can back it. A run
   * resumed from a save that predates the journal quotes nothing.
   */
  const [dealtCards, biasedCards] = useMemo(() => {
    const weak = run.weakSpots;
    if (!weak?.length || !run.journal) return [0, 0];
    let dealt = 0;
    let biased = 0;
    for (const y of run.journal) {
      for (const id of y.deal) {
        dealt++;
        if (eventTeachesAny(id, weak)) biased++;
      }
    }
    return [dealt, biased];
  }, [run.weakSpots, run.journal]);
  const { setBrainGlow } = useAudio();
  const [shareOpen, setShareOpen] = useState(false);
  const shareUrl = useShareUrl(run);
  const nw = netWorth(run);

  // warm the calm report bed by how rich the Money Brain has become
  useEffect(() => {
    setBrainGlow(moneyBrainPct(mastery) / 100);
  }, [mastery, setBrainGlow]);

  // The statement owns the screen. A concept chip fired by the run's last event was still
  // in the queue when the recap settled, and the toast is anchored at top-24 to clear the
  // in-run HUD — which this screen does not have, so it landed squarely on the masthead and
  // covered the player's name. It is redundant here anyway: the report prints every concept
  // the run sharpened, a few sections down.
  useEffect(() => {
    document.body.dataset.statement = "1";
    return () => { delete document.body.dataset.statement; };
  }, []);
  const reason = REASON[run.endReason ?? "quit"];
  const Icon = reason.Icon;
  const klass = deriveVerdict(run);

  const hist = run.history;
  // The counterfactual: the same life, the same cards, the same choices — only the
  // money moved differently. Null for a run that cannot be replayed (a save from
  // before the engine journalled, or one that came back from a room), and the
  // section simply does not render rather than printing a gap it cannot compute.
  const ghost = useMemo(() => ghostFor(run), [run]);
  // A daily run also gets the grid: one cell per year, you against that ghost.
  // Null for every other run, and for a daily whose ghost could not be built.
  //
  // Rebuilt when `shareUrl` resolves. `useShareUrl` starts at the bare origin and
  // upgrades to this run's own statement link a second or two later, so a block
  // built once at mount would put the wrong URL on every clipboard.
  const firstYear = hist[0]?.year ?? run.startYear;
  const lastYear = hist[hist.length - 1]?.year ?? run.startYear;
  const best = [...hist].sort((a, b) => b.portfolioDelta - a.portfolioDelta)[0];
  const worst = [...hist].sort((a, b) => a.portfolioDelta - b.portfolioDelta)[0];
  // A run whose worst year still finished green has no "hit" — clamping it to zero
  // printed "−$0" in loss red, which is both wrong and unearned drama. The BEST card
  // carried the mirror image of the same bug: a player who never bought anything has
  // a portfolio delta of exactly 0 every year, and the card told them "−$0 — even your
  // best year lost money" in loss red while the card beside it said "you never had a
  // down year". Neither swing exists, so both cards now say so.
  const tookAHit = !!worst && worst.portfolioDelta < 0;
  const bestUp = !!best && best.portfolioDelta > 0;
  const bestDown = !!best && best.portfolioDelta < 0;
  const wonSomewhere = !!worst && worst.portfolioDelta > 0;
  /** No holdings all run: there is no best or worst market year to report. */
  const neverInvested = !!best && best.portfolioDelta === 0 && !!worst && worst.portfolioDelta === 0;

  // Rebuilt every render, this redrew ShareCard's whole 1080×1920 canvas on every
  // parent tick — and this screen has running counters.
  const share = useMemo(() => dailyShare(run, shareUrl), [run, shareUrl]);

  const shareData = useMemo(
    () => ({
      verdict: klass.title,
      verdictHex: klass.hex,
      netWorth: nw,
      netWorthText: currency(nw),
      years: hist.length,
      runId: `${run.mode}-${run.seed}`,
      history: hist.map((h) => h.netWorth),
      statLabel: "Biggest hit",
      statValue: tookAHit ? `−${currency(Math.abs(worst.portfolioDelta))}` : "None",
      url: shareUrl,
    }),
    [klass.title, klass.hex, nw, hist, run.mode, run.seed, tookAHit, worst, shareUrl],
  );

  // Owed lines carry their sign and the loss tone. Printed as bare positives in the
  // same ink as "Home equity", a $152k mortgage read as something the player HAD,
  // and no arrangement of the six rows added up to the net worth above them.
  const ledger: { label: string; value: string; tone?: string }[] = [
    { label: "Net worth", value: currency(nw) },
    ...(run.homeValue > 0 ? [{ label: "Home equity", value: currency(homeEquity(run)) }] : []),
    ...(run.mortgage > 0 ? [{ label: "Mortgage", value: currency(-run.mortgage), tone: "text-loss" }] : []),
    { label: "Debt", value: currency(-run.debt), tone: run.debt > 0 ? "text-loss" : undefined },
    { label: "Final salary", value: `${currency(run.salary)}/yr` },
    { label: "Years lived", value: `${hist.length}` },
  ];

  return (
    <div className="mx-auto min-h-[100svh] w-full max-w-2xl px-5 py-16">
      {/* Outside the stagger: the sound control is chrome, not part of the reveal. */}
      <SoundCell className="mb-5" />
      <motion.div variants={container} initial="hidden" animate="show">
        {/* masthead — the statement header */}
        <motion.header variants={item} className="border-b border-hairline pb-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="eyebrow text-secondary">{run.endReason === "insolvent" ? "Closing Statement" : "Life Statement"}</p>
            <p className={`eyebrow flex items-center gap-1.5 ${run.endReason === "insolvent" ? "text-loss" : "text-secondary"}`}>
              {run.endReason === "insolvent" && <span aria-hidden>▲</span>}
              <Icon size={13} /> {reason.label}
            </p>
          </div>
          <h1 className="display-caps mt-3 text-3xl text-ink sm:text-4xl">{run.name}</h1>
          <p className="num mt-1.5 text-[0.8rem] text-secondary">
            {firstYear}–{lastYear} · age {run.history[0]?.age ?? run.age}–{run.age} · {run.job}
          </p>
        </motion.header>

        {/* verdict — a left-aligned ink stamp, blurb as a voice line */}
        <motion.div variants={item} className="mt-6">
          <div className="inline-block border-2 px-5 py-2.5" style={{ borderColor: klass.hex, color: klass.hex }}>
            <p className="eyebrow" style={{ fontSize: "0.56rem" }}>Final verdict</p>
            <p className="display-caps text-3xl sm:text-4xl">{klass.title}</p>
          </div>
          <p className="voice mt-3 max-w-lg text-[1.05rem] leading-snug text-ink/80">{klass.blurb}</p>
        </motion.div>

        {/* a run the engine had to close: the receipt, before the ledger */}
        {run.endReason === "insolvent" && <ClosingStatement run={run} />}

        {/* statement — dot-leader ledger rows */}
        <motion.section variants={item}>
          <SectionLabel>Statement</SectionLabel>
          {ledger.map((r, i) => (
            <LedgerRow key={r.label} label={r.label} value={r.value} tone={r.tone} strong={i === 0} />
          ))}
          {/* The record this statement was measured against — the same `nw` the
              submit ranks, so the comparison is the board's, not a second one.
              Renders nothing until it is known, and nothing if it could not be
              read. */}
          <PersonalBestRow mode={run.mode} score={nw} />
        </motion.section>

        {/* annotated net-worth line — biggest one-year moves + the macro events crossed */}
        {hist.length > 1 && (
          <motion.div variants={item}>
            <SectionLabel>Net worth, year by year</SectionLabel>
            <AnnotatedLifeChart
              points={hist.map((h) => ({ year: h.year, netWorth: h.netWorth }))}
              ghost={ghost?.points}
            />
          </motion.div>
        )}

        {/* The gap. Gain/loss is the RIGHT channel here and the only place in this
            feature it appears: the difference is money, which is what those two
            colours are for. `currency` prints U+2212 for a negative, so the sign
            carries it without the hue. Signed from the player's side — green means
            you beat it. */}
        {ghost && (
          <motion.div variants={item}>
            <SectionLabel>The other version of this life</SectionLabel>
            <LedgerRow label="You ended with" value={currency(nw)} strong />
            <LedgerRow label="Every spare dollar in the index" value={currency(ghost.final)} />
            <LedgerRow
              label="The difference"
              value={currency(nw - ghost.final)}
              tone={nw - ghost.final >= 0 ? "text-gain" : "text-loss"}
            />
            <p className="voice mt-3 text-[0.95rem] leading-snug text-secondary">
              {ghost.truncated
                ? `The other version ran out of road before you did — there is nothing to compare after ${ghost.points[ghost.points.length - 1].year}.`
                : `Same life, same cards, same choices, and the same payments to your debt — only what was left over moved differently. ${GHOST_BUFFER_MONTHS} months of costs stay in cash; everything above that goes into the index, every year.`}
            </p>
          </motion.div>
        )}

        {/* the daily's grid — right after the ghost it is built from */}
        {share && <DailyGrid share={share} />}

        {/* final portfolio */}
        <motion.div variants={item}>
          <SectionLabel>Where your money ended up</SectionLabel>
          <PortfolioBreakdown run={run} />
        </motion.div>

        {/* best / worst — named MARKET years.
            These are a different measurement from the chart's RISE and FALL, and the two
            used to sit 200px apart with nothing saying so: a run could print "RISE 2001
            +$43,141 / FALL 2005 −$96,228" on the chart and "BEST YEAR $0 / WORST YEAR $0"
            here and read as self-contradicting. The chart tracks NET WORTH (wages, debt,
            the house, everything); these two track only what the market did to the
            portfolio — which is exactly $0 for a player who never bought anything. Both
            are now labelled for what they measure, and the header says it once. */}
        {best && worst && (
          <motion.div variants={item}>
            <SectionLabel>Your investments, best and worst</SectionLabel>
            <p className="mb-3 font-body text-[0.82rem] leading-snug text-secondary">
              What the market alone added to or took from your portfolio. The chart above is a
              different figure — net worth, which also moves with your pay, your debt and your home.
            </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className={`border border-hairline border-l-2 bg-bg2 p-4 ${bestUp ? "border-l-gain" : "border-l-hairline-strong"}`}>
              <p className={`eyebrow ${bestUp ? "text-gain" : "text-secondary"}`}>Best market year · {neverInvested ? "—" : best.year}</p>
              <p className={`num text-lg ${bestUp ? "text-gain" : bestDown ? "text-loss" : "text-secondary"}`}>
                {bestUp ? `+${currency(best.portfolioDelta)}` : bestDown ? `−${currency(Math.abs(best.portfolioDelta))}` : currency(0)}
              </p>
              <p className="voice mt-1 text-[0.92rem] text-secondary">
                {bestUp
                  ? macroEvent(best.year)?.title ?? "A quiet, green year."
                  : bestDown
                    ? "Even your best year lost money."
                    : "You never put a dollar in the market, so it never paid you one."}
              </p>
            </div>
            <div className={`border border-hairline border-l-2 bg-bg2 p-4 ${tookAHit ? "border-l-loss" : "border-l-hairline-strong"}`}>
              <p className={`eyebrow ${tookAHit ? "text-loss" : "text-secondary"}`}>Worst market year · {neverInvested ? "—" : worst.year}</p>
              <p className={`num text-lg ${tookAHit ? "text-loss" : wonSomewhere ? "text-gain" : "text-secondary"}`}>
                {tookAHit ? `−${currency(Math.abs(worst.portfolioDelta))}` : wonSomewhere ? `+${currency(worst.portfolioDelta)}` : currency(0)}
              </p>
              <p className="voice mt-1 text-[0.92rem] text-secondary">
                {tookAHit
                  ? macroEvent(worst.year)?.title ?? "The market just shrugged."
                  : wonSomewhere
                    ? "You never had a down year."
                    : "Nothing invested means nothing to lose — and nothing to gain."}
              </p>
            </div>
          </div>
          </motion.div>
        )}

        <motion.p variants={item} className="num mt-6 text-[0.75rem] text-secondary">
          {run.life.partner ? "Married" : "Single"} · {run.life.kids} kid{run.life.kids === 1 ? "" : "s"} · {run.life.housing === "owned" ? "homeowner" : "renter"} · {run.job}
        </motion.p>

        {/* money brain */}
        <motion.div variants={item} className="mt-6 border border-hairline bg-bg2 px-4 py-4 text-ink">
          <MoneyBrainMeter mastery={mastery} />
          {runGains.length > 0 && (
            <p className="mt-2 font-body text-[0.9rem] text-secondary">
              This run sharpened: <span className="text-ink">{runGains.map(conceptTitle).join(", ")}</span>.
            </p>
          )}
          <button type="button" onClick={onMasteryMap} className="eyebrow mt-3 inline-flex items-center gap-1.5 text-ink transition-opacity hover:opacity-70">
            <BrainIcon size={13} /> View your Money Brain →
          </button>
        </motion.div>

        {/* Weak spots.
            In the INK scale, not chartreuse: that hue has exactly four sanctioned
            homes (the streak chip, the Money Brain meter, the mastery ticks and the
            concept toast) and a fifth is a contract change, not a styling choice.
            Not loss-red either — this is a gap, not a loss, and the register the
            house uses for a gap names it without scolding. */}
        {(weakSpots.length > 0 || (run.weakSpots?.length ?? 0) > 0) && (
          <motion.div variants={item}>
            <SectionLabel>Weak spots</SectionLabel>
            {run.weakSpots && run.weakSpots.length > 0 && (
              <p className="font-body text-[0.9rem] leading-snug text-secondary">
                This run&rsquo;s deck was already weighted toward{" "}
                <span className="text-ink">{run.weakSpots.map(conceptTitle).join(" and ")}</span>
                {biasedCards ? ` — ${biasedCards} of the ${dealtCards} cards it dealt you were about them` : ""}.
              </p>
            )}
            {weakSpots.length > 0 && (
              <>
                <div className={run.weakSpots?.length ? "mt-3" : ""}>
                  {weakSpots.map((w) => (
                    <LedgerRow
                      key={w.conceptId}
                      label={conceptTitle(w.conceptId)}
                      value={`${w.tally.miss} of ${w.tally.hit + w.tally.miss} went badly`}
                      size="0.82rem"
                    />
                  ))}
                </div>
                <p className="voice mt-3 text-[0.95rem] leading-snug text-secondary">
                  {weakSpots.length === 1
                    ? "This is the concept your decisions keep going wrong on. Your next run will deal more cards about it — the deck knows, and now so do you."
                    : "These are the two concepts your decisions keep going wrong on. Your next run will deal more cards about them — the deck knows, and now so do you."}
                </p>
              </>
            )}
          </motion.div>
        )}

        {/* actions */}
        <motion.div variants={item} className="mt-8 flex flex-wrap gap-3 border-t border-hairline pt-6">
          {onBackToStandings && (
            <NeonButton variant="secondary" size="lg" onClick={onBackToStandings}>
              ← Back to the standings
            </NeonButton>
          )}
          {/* "Run it back" is a lie on a daily statement: today's world is spent, and
              this button starts a fresh Story run with its own random seed. It says
              so rather than implying a second attempt at the same puzzle. */}
          <NeonButton variant="primary" size="lg" onClick={onReplay}>
            <ReplayIcon size={18} /> {run.daily ? "Start a fresh Story run" : "Run it back"}
          </NeonButton>
          <NeonButton variant="secondary" size="lg" onClick={() => setShareOpen(true)}>Share ↗</NeonButton>
          <NeonButton variant="secondary" size="md" onClick={onAlmanac}>Almanac</NeonButton>
          <NeonButton variant="ghost" size="md" onClick={onTitle}>Title screen</NeonButton>
        </motion.div>
      </motion.div>

      {shareOpen && <ShareCard data={shareData} onClose={() => setShareOpen(false)} />}
    </div>
  );
}

/**
 * The daily's grid: one cell per year, you against your own index ghost.
 *
 * The glyphs differ in SHAPE — filled triangle up, bar, filled triangle down — not
 * in colour, because this block exists to be pasted into places that strip every
 * bit of styling, and because a coloured square would carry no meaning at all in
 * monochrome. They are rendered in the ink scale for the same reason: gain and loss
 * green/red would read as "the market went up", and the cell says nothing of the
 * kind. It says how YOU did against it.
 *
 * The text on the clipboard and the text on screen come from one function
 * (`lib/dailyShare.ts`), so the grid a player sees and the grid they paste cannot
 * drift apart.
 */
function DailyGrid({ share }: { share: NonNullable<ReturnType<typeof dailyShare>> }) {
  const { sfx } = useAudio();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(share.text);
      setCopied(true);
      sfx("uitick");
    } catch {
      // No clipboard API, or no permission. The grid is selectable text right there.
      setCopied(false);
    }
  }

  return (
    <motion.div variants={item}>
      <SectionLabel>Daily Ledger · No. {share.number}</SectionLabel>
      {/* One figure, one label. The glyphs themselves are hidden from assistive tech
          — read out, they are twenty-one geometry names and no meaning — and the
          count they encode is what the label says instead.

          A real CSS grid rather than a letter-spaced string: U+25AC (▬) is a wide
          glyph, and six level years in a row fused into one continuous bar that
          could not be counted. One cell per column, fixed width, so the block reads
          as a grid at any zoom and matches the spaced text on the clipboard. */}
      <figure role="img" aria-label={gridSummary(share.cells)} className="m-0 mt-3">
        <div
          className="grid w-max gap-x-2.5 gap-y-1.5"
          style={{ gridTemplateColumns: `repeat(${GRID_ROW}, 1.1rem)` }}
        >
          {share.cells.map((c, i) => (
            <span key={i} aria-hidden className="num text-center text-[1.05rem] leading-none text-ink">
              {gridGlyph(c)}
            </span>
          ))}
        </div>
      </figure>
      <p className="voice mt-3 text-[0.92rem] text-secondary">
        ▲ ahead of the index that year · ▬ level · ▼ behind. No calendar years, so it
        spoils nothing for anyone still playing today.
      </p>
      {share.ungraded > 0 && (
        <p className="voice mt-1 text-[0.92rem] text-secondary">
          {share.ungraded === 1 ? "Your last year has" : `Your last ${share.ungraded} years have`}{" "}
          no cell: the index version of this life went under before you did, so after that
          there was nothing left to measure you against.
        </p>
      )}
      <div className="mt-4">
        <NeonButton variant="secondary" size="md" onClick={copy}>
          {copied ? "Copied ✓" : "Copy the grid"}
        </NeonButton>
      </div>
    </motion.div>
  );
}
