// DRAFT — review with counsel before relying on this as your formal
// policy. This is a starter that covers the actual data flows we have
// today (no auth, email collection for alerts, basic analytics) and the
// 2024 Gmail/Yahoo sender disclosures. Update the contact address.

export const metadata = {
  title: 'Privacy — WorthGoing',
  description: 'How we collect, use, and protect your information.',
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen" style={{ background: '#0a0a0d' }}>
      <div className="max-w-2xl mx-auto px-6 py-12">
        <a href="/" className="text-sm font-medium" style={{ color: '#9090a0' }}>← Back to WorthGoing</a>

        <h1
          className="mt-6 text-4xl tracking-tight"
          style={{ color: '#fafafa', fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: '-0.025em' }}
        >
          Privacy
        </h1>
        <p className="mt-2 text-sm" style={{ color: '#7a7a85' }}>Last updated: June 2026</p>

        <div className="prose prose-invert mt-8 space-y-6 text-[15px] leading-relaxed" style={{ color: '#d4d4dc' }}>
          <p>
            WorthGoing helps you decide if a sports game is worth going to.
            We try to collect as little personal information as possible.
            This page explains what we collect, why, and how to remove it.
          </p>

          <h2 className="text-xl font-semibold mt-8" style={{ color: '#fafafa' }}>What we collect</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li><strong style={{ color: '#fafafa' }}>Email address</strong> — only if you sign up for a price-drop alert on a specific game.</li>
            <li><strong style={{ color: '#fafafa' }}>Approximate location</strong> — derived from your IP address by our hosting provider (Vercel) so we can default the right city for you. We never store your IP.</li>
            <li><strong style={{ color: '#fafafa' }}>Your city + date preference</strong> — stored in your browser&apos;s localStorage so the site remembers which market you&apos;re browsing. This never leaves your device.</li>
            <li><strong style={{ color: '#fafafa' }}>Basic analytics</strong> — page views and feature usage in aggregate. No tracking pixels, no cross-site cookies.</li>
          </ul>

          <h2 className="text-xl font-semibold mt-8" style={{ color: '#fafafa' }}>How we use it</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li>Send the price-drop alerts you signed up for, plus the one-time confirmation email.</li>
            <li>Improve the site (which games people care about, which features get used).</li>
          </ul>
          <p>
            We <strong style={{ color: '#fafafa' }}>do not</strong> sell your information. We <strong style={{ color: '#fafafa' }}>do not</strong> share it with advertisers. We don&apos;t use it for any purpose you didn&apos;t opt into.
          </p>

          <h2 className="text-xl font-semibold mt-8" style={{ color: '#fafafa' }}>Vendors we use</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li><strong style={{ color: '#fafafa' }}>Brevo</strong> — sends the alert and confirmation emails. Your email address is shared with them only for delivery.</li>
            <li><strong style={{ color: '#fafafa' }}>Supabase</strong> — hosts our database. Your email is stored encrypted at rest in the US.</li>
            <li><strong style={{ color: '#fafafa' }}>Vercel</strong> — hosts the site. Receives standard request logs (IP, user-agent, path) which they retain per their policy.</li>
          </ul>

          <h2 className="text-xl font-semibold mt-8" style={{ color: '#fafafa' }}>Removing your data</h2>
          <p>
            Every alert email has a one-click unsubscribe link in the footer. Clicking it removes you from all future emails for that game.
            To delete an email address entirely from our database, reach out at the address below and we&apos;ll handle it within 7 days.
          </p>

          <h2 className="text-xl font-semibold mt-8" style={{ color: '#fafafa' }}>Children</h2>
          <p>WorthGoing isn&apos;t directed at children under 13. We don&apos;t knowingly collect data from them.</p>

          <h2 className="text-xl font-semibold mt-8" style={{ color: '#fafafa' }}>Changes</h2>
          <p>If we materially change this page, the &quot;last updated&quot; date above changes too. For email subscribers, we&apos;ll notify you of any significant change before it takes effect.</p>

          <h2 className="text-xl font-semibold mt-8" style={{ color: '#fafafa' }}>Contact</h2>
          <p>
            Questions or data removal requests:{' '}
            <a href="mailto:hello@worthgoing.to" className="underline" style={{ color: '#fafafa' }}>hello@worthgoing.to</a>
          </p>
        </div>
      </div>
    </main>
  );
}
