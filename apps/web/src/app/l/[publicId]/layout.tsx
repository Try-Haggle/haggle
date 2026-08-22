/**
 * The listing route deliberately has no bottom tab bar on mobile.
 *
 * The page carries its own fixed bottom bar — asking price, chosen agent, and
 * the Start-negotiation action that replaces the CTA once it scrolls away — and
 * two stacked bottom bars is worse than either alone. It is not a hypothetical
 * conflict: the tab bar (z-50) sat directly on top of that action bar (z-40)
 * and hid the page's primary conversion control entirely.
 *
 * Every marketplace that ships a bottom action bar on its item page resolves it
 * the same way (Airbnb, Carousell, Facebook Marketplace): the tab bar goes, and
 * the page's own back link carries the way out — which this page has, top-left.
 *
 * It also makes the page behave the same for everyone. A listing is a shared
 * destination reached from anywhere, and signed-out visitors never had a tab bar
 * here to begin with.
 */
export default function ListingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
