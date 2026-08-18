// Shared QA harness: browser boot, error capture, assertions, screenshots.
//
// The bundled chromium is pinned by the environment, not by the playwright
// package, so the executable is discovered rather than assumed — the version
// playwright wants and the version installed here do not have to match.
import { chromium } from "playwright";
import { mkdirSync, globSync, writeFileSync } from "fs";
import path from "path";

export const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";
export const SHOT_DIR = process.env.QA_SHOT_DIR ?? "/tmp/lifepatch-qa";

export const DESKTOP = { width: 1440, height: 900 };
export const MOBILE = { width: 390, height: 844 };

function chromiumPath() {
  const found = globSync("/opt/pw-browsers/chromium-*/chrome-linux/chrome");
  if (found.length) return found.sort().at(-1);
  return undefined; // fall back to playwright's own download
}

/** Text that must never reach the player's screen. */
const POISON = /\bNaN\b|\bundefined\b|\bInfinity\b|\$-?\d{10,}|\[object Object\]/;

/** Console noise that is environmental, not a defect under test. */
const IGNORED_CONSOLE = [
  /Download the React DevTools/i,
  /React DevTools/i,
  /Fast Refresh/i,
  /\[Fast Refresh\]/i,
  /Next.js Dev Tools/i,
  /webpack-hmr/i,
  /Autoplay is only allowed/i, // headless has no audio device
  /The AudioContext was not allowed to start/i,
  /play\(\) failed because the user didn't interact/i,
];

export class Run {
  constructor(name) {
    this.name = name;
    this.errors = [];
    this.findings = [];
    this.shots = [];
    mkdirSync(SHOT_DIR, { recursive: true });
  }

  finding(severity, where, detail) {
    this.findings.push({ severity, where, detail });
    console.log(`  [${severity}] ${where} — ${detail}`);
  }

  async open(viewport = DESKTOP, { skipIntro = true, seed } = {}) {
    this.browser = await chromium.launch({ executablePath: chromiumPath() });
    this.ctx = await this.browser.newContext({ viewport, reducedMotion: process.env.QA_REDUCED === "1" ? "reduce" : "no-preference" });
    this.page = await this.ctx.newPage();

    if (skipIntro) {
      await this.page.addInitScript(() => {
        try { sessionStorage.setItem("lp_introSeen", "1"); } catch {}
      });
    }

    this.page.on("console", (m) => {
      if (m.type() !== "error" && m.type() !== "warning") return;
      const text = m.text();
      if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
      if (m.type() === "error") this.errors.push(text.slice(0, 300));
    });
    this.page.on("pageerror", (e) => this.errors.push("PAGEERROR: " + (e.message ?? String(e)).slice(0, 300)));

    const url = seed ? `${BASE}/?seed=${seed}` : BASE;
    await this.page.goto(url, { waitUntil: "domcontentloaded" });
    await this.page.waitForTimeout(1200);
    return this.page;
  }

  /** Screenshot + scan the visible text for poison values. */
  async snap(label) {
    const file = path.join(SHOT_DIR, `${this.name}-${label}.png`);
    await this.page.screenshot({ path: file, fullPage: false });
    this.shots.push(file);
    const text = await this.page.evaluate(() => document.body.innerText);
    const hit = text.match(POISON);
    if (hit) this.finding("HIGH", label, `poison text on screen: "${hit[0]}" `);
    return file;
  }

  async text() {
    return (await this.page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
  }

  /** Visible interactive controls, de-duplicated, for coverage reporting. */
  async controls() {
    return [...new Set(await this.page.$$eval("button, a[href], [role=button]", (els) =>
      els
        .filter((e) => e.offsetParent !== null && !e.hasAttribute("data-nextjs-dev-tools-button"))
        .map((e) => (e.innerText || e.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 60))
        .filter(Boolean)))];
  }

  /** Click a button by accessible name; returns false when absent (never throws). */
  async click(name, { wait = 900, timeout = 6000 } = {}) {
    const el = this.page.getByRole("button", { name: typeof name === "string" ? new RegExp(name, "i") : name }).first();
    if (!(await el.count())) return false;
    if (!(await el.isVisible().catch(() => false))) return false;
    if (!(await el.isEnabled().catch(() => false))) return false;
    // a swallowed click looks identical to a successful one, which makes a stuck
    // overlay read as progress — report the failure instead
    let ok = true;
    await el.click({ timeout }).catch((e) => {
      ok = false;
      this.lastClickError = `${name}: ${String(e.message ?? e).split("\n")[0].slice(0, 160)}`;
    });
    await this.page.waitForTimeout(wait);
    return ok;
  }

  /** Click the first of several candidate labels that exists. */
  async clickAny(names, opts) {
    for (const n of names) if (await this.click(n, opts)) return n;
    return null;
  }

  /** Pick a selectable card (profession / dream / mode / background tile). */
  async pickCard(index = 0, { wait = 700 } = {}) {
    const cards = this.page.locator("button:has(h1), button:has(h2), button:has(h3)");
    const n = await cards.count();
    if (n <= index) return false;
    const card = cards.nth(index);
    if (!(await card.isVisible().catch(() => false))) return false;
    await card.click({ timeout: 6000 }).catch(() => {});
    await this.page.waitForTimeout(wait);
    return true;
  }

  /** Read a labelled figure straight out of the rendered page text. */
  async readNear(label, window = 90) {
    const text = await this.text();
    const i = text.search(new RegExp(label, "i"));
    return i === -1 ? null : text.slice(i, i + window);
  }

  async close() {
    await this.browser?.close();
  }

  report() {
    const bySev = (s) => this.findings.filter((f) => f.severity === s).length;
    const summary = {
      run: this.name,
      consoleErrors: this.errors,
      findings: this.findings,
      counts: { HIGH: bySev("HIGH"), MED: bySev("MED"), LOW: bySev("LOW"), consoleErrors: this.errors.length },
      screenshots: this.shots,
    };
    writeFileSync(path.join(SHOT_DIR, `${this.name}-report.json`), JSON.stringify(summary, null, 2));
    console.log(`\n── ${this.name}: ${summary.counts.HIGH} high · ${summary.counts.MED} med · ${summary.counts.LOW} low · ${this.errors.length} console errors`);
    if (this.errors.length) console.log("  console:", this.errors.slice(0, 8));
    return summary;
  }
}

/** Read a number out of a "$1,350" / "-$60,100" / "42%" style string. */
export function num(s) {
  if (!s) return null;
  const m = String(s).replace(/[, ]/g, "").match(/-?[−–]?\$?(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const negative = /[−–-]\s*\$?\d/.test(String(s).replace(/[, ]/g, ""));
  const v = Number(m[1]);
  return negative && v > 0 ? -v : v;
}
