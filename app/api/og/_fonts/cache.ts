/**
 * Read a set of bundled font files once per isolate, not once per request.
 *
 * Both OG surfaces fetched their two `.ttf`s inside the handler, so every unfurl
 * re-read two immutable build assets before it could draw anything — on a surface
 * whose whole design is a scraper waiting on a socket. Hoisting the read to module
 * scope caches it for the life of the isolate and takes both off the hot path.
 *
 * MEMOISED ON SUCCESS ONLY. A promise cached the moment it is created pins its
 * REJECTION too, which would turn one transient read failure into a permanently
 * fontless isolate — the /api/og/[id] route's fallback branch exists precisely
 * because that read can fail, and it is written to survive a hiccup, not to
 * inherit one. Clearing the slot on failure means the next request tries again.
 *
 * The `new URL(…, import.meta.url)` expressions stay in the route files that own
 * them: that is the form the bundler recognises when it emits the asset, and it
 * keeps each route's font paths readable where the fonts are used.
 */
export function cachedFonts(urls: URL[]): () => Promise<ArrayBuffer[]> {
  let pending: Promise<ArrayBuffer[]> | null = null;
  return () => {
    if (!pending) {
      pending = Promise.all(urls.map((u) => fetch(u).then((r) => r.arrayBuffer()))).catch((e) => {
        pending = null;
        throw e;
      });
    }
    return pending;
  };
}
