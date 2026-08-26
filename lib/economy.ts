/**
 * The run economy's dials, in one leaf module.
 *
 * These live here rather than in `runEngine` because `lifeEvents` needs a few of
 * them at module-evaluation time (the housing event quotes the down payment) and
 * `runEngine` already imports `lifeEvents` — importing back the other way would
 * be a cycle with a live temporal-dead-zone hazard.
 *
 * Figures are nominal dollars, chosen to stay recognisable to a teenager rather
 * than to be era-accurate: a 1957 salary of $34,000 is already a deliberate
 * simplification, and housing follows the same convention.
 */

// — prices and pay ————————————————————————————————————————————————
/** What a year of living costs grows by. Expenses used to be flat forever, which
 *  made the back half of a 40-year run free. */
export const INFLATION = 0.025;
/** Nominal salary drift while employed — ~0.5pt of real wage growth a year. */
export const WAGE_GROWTH = 0.03;
/** Take-home after income tax + payroll. */
export const TAKE_HOME = 0.78;
/** Food, transport, insurance — everything that isn't housing or kids. */
export const BASE_LIVING = 14000;
export const KID_COST = 9000;
/** Year-one rent. Inflates with everything else. */
export const RENT_START = 14000;

// — housing ————————————————————————————————————————————————————
// Buying is a real trade: capital out, a bigger fixed outflow, and a leveraged
// asset that can and does go down (see the 2007–2011 real-estate overrides).
/** Year-one asking price. Restated to the price level at the moment of purchase
 *  — see `applyLifeChoice`. Left nominal it was a structural exploit: by Infinite
 *  year 60 rent had inflated to $61,600/yr while the same $220,000 house still
 *  carried a fixed $13,376/yr mortgage, so buying returned ~97% a year, forever. */
export const HOME_PRICE = 220000;
/** What the player actually puts down. Deliberately NOT restated: a down payment
 *  that keeps perfect pace with house prices is the one thing that never happens,
 *  and the widening gap between the two is the affordability lesson. Buying late
 *  means buying with more leverage. */
export const HOME_DOWN_PAYMENT = Math.round(HOME_PRICE * 0.2);
export const MORTGAGE_RATE = 0.06;
/** A 30-year level payment at 6% is ≈ 7.6% of the original loan each year. Applied
 *  to the loan THIS player actually signed (`RunState.mortgagePayment`), not to a
 *  fixed figure — an inflated price against a nominal payment never amortises. */
export const MORTGAGE_PAYMENT_RATE = 0.076;
/** The year-one payment, kept as the shape of the number for reference and for a
 *  purchase made in year one, where the two are identical by construction. */
export const MORTGAGE_PAYMENT = Math.round((HOME_PRICE - HOME_DOWN_PAYMENT) * MORTGAGE_PAYMENT_RATE);
/** Property tax + insurance + maintenance, as a share of the home's value. */
export const HOME_UPKEEP = 0.025;
/** Agent commission, closing costs and the repairs a buyer's survey finds. Selling
 *  a house is not the reverse of buying one, and a model where it is turns the
 *  home into a savings account you can dip into. */
export const HOME_SALE_COST = 0.06;

// — unsecured debt ——————————————————————————————————————————————
export const DEBT_RATE = 0.07;
/** Interest plus a principal slice, demanded every year — not optional. */
export const DEBT_MIN_PCT = 0.15;
/** So a small balance actually clears instead of trickling forever. */
export const DEBT_MIN_FLOOR = 1200;

/** The 4% rule: you can stop working once 25× your yearly costs is invested. */
export const RETIRE_MULTIPLE = 25;
