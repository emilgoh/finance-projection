/**
 * Hash routing for the two pages.
 *
 * The hash is the whole router state — no history entries are pushed by hand,
 * so the back button walks pages for free and a link like `#/tracker` opens
 * straight onto the log.
 */

export const PAGES = ["projection", "tracker"];
export const DEFAULT_PAGE = "projection";

/** Anything unrecognised — an empty hash, a stale bookmark — lands on the default. */
export function pageFromHash(hash) {
  const name = String(hash ?? "").replace(/^#\/?/, "").toLowerCase();
  return PAGES.includes(name) ? name : DEFAULT_PAGE;
}

export function hashForPage(page) {
  return `#/${pageFromHash(page)}`;
}

/**
 * Calls `onChange(page)` now and on every hash change, and returns a disposer.
 * The immediate call is what paints the first page, so callers never have to
 * duplicate the initial render.
 */
export function startRouter(win, onChange) {
  const fire = () => onChange(pageFromHash(win.location.hash));
  win.addEventListener("hashchange", fire);
  fire();
  return () => win.removeEventListener("hashchange", fire);
}
