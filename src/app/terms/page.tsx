// DRAFT — review with counsel before relying on this as your formal
// Terms of Service. Boilerplate covers the basics (no warranty on
// prices, third-party ticket sales are between you and the seller).

export const metadata = {
  title: 'Terms — WorthGoing',
  description: 'Terms of use for WorthGoing.',
};

export default function TermsPage() {
  return (
    <main className="min-h-screen" style={{ background: '#0a0a0d' }}>
      <div className="max-w-2xl mx-auto px-6 py-12">
        <a href="/" className="text-sm font-medium" style={{ color: '#9090a0' }}>← Back to WorthGoing</a>

        <h1
          className="mt-6 text-4xl tracking-tight"
          style={{ color: '#fafafa', fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: '-0.025em' }}
        >
          Terms
        </h1>
        <p className="mt-2 text-sm" style={{ color: '#7a7a85' }}>Last updated: June 2026</p>

        <div className="prose prose-invert mt-8 space-y-6 text-[15px] leading-relaxed" style={{ color: '#d4d4dc' }}>
          <p>
            By using WorthGoing you agree to these terms. They&apos;re short on purpose.
          </p>

          <h2 className="text-xl font-semibold mt-8" style={{ color: '#fafafa' }}>What WorthGoing is</h2>
          <p>
            We aggregate publicly available data about sports games (matchups, venues, partner ticket prices) and surface a curated take on whether the game is worth going to. We are not a ticket seller. We don&apos;t process payments. We don&apos;t set prices.
          </p>

          <h2 className="text-xl font-semibold mt-8" style={{ color: '#fafafa' }}>Ticket prices and links</h2>
          <p>
            Prices shown on game cards come from third-party marketplaces (SeatGeek, TickPick, StubHub, Vivid Seats, Gametime, Ticketmaster, and others). They change minute by minute and may include or exclude fees depending on the source. The price you actually pay is the one at checkout on the marketplace you choose. We don&apos;t guarantee any price you see here.
          </p>
          <p>
            We may earn an affiliate commission when you click through to a marketplace and buy a ticket. This never changes the price you pay. If we earn a commission on a click, the marketplace knows about it — we don&apos;t.
          </p>

          <h2 className="text-xl font-semibold mt-8" style={{ color: '#fafafa' }}>Price-drop alerts</h2>
          <p>
            If you sign up for an alert, we&apos;ll email you when the cheapest price across our sources drops by the threshold you picked. Alerts are best-effort. The price may move again by the time you click through. We won&apos;t spam you — at most one email per 24 hours per alert, and a one-click unsubscribe in every email.
          </p>

          <h2 className="text-xl font-semibold mt-8" style={{ color: '#fafafa' }}>Acceptable use</h2>
          <p>
            Don&apos;t scrape the site programmatically, abuse the alert system to flood third parties, or attempt to access data you don&apos;t own. If you&apos;re a researcher who wants the data, reach out and we&apos;ll probably help.
          </p>

          <h2 className="text-xl font-semibold mt-8" style={{ color: '#fafafa' }}>No warranty</h2>
          <p>
            WorthGoing is provided as-is. We do our best to keep the information accurate but we don&apos;t promise the site will be available 24/7 or that every price is correct. Decisions you make based on the site are yours.
          </p>

          <h2 className="text-xl font-semibold mt-8" style={{ color: '#fafafa' }}>Changes</h2>
          <p>
            We may update these terms. The &quot;last updated&quot; date will reflect it. Material changes to the alert feature will be emailed to active subscribers in advance.
          </p>

          <h2 className="text-xl font-semibold mt-8" style={{ color: '#fafafa' }}>Contact</h2>
          <p>
            <a href="mailto:hello@worthgoing.to" className="underline" style={{ color: '#fafafa' }}>hello@worthgoing.to</a>
          </p>
        </div>
      </div>
    </main>
  );
}
