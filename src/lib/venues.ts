// Venue logistics lookup — parking + transit info.
// Display-only data the GameCard renders under the ticket price so
// visitors see the real "cost of going" at a glance and know if there's
// a transit alternative worth taking. Same venue is shared across teams
// (e.g. Trail Blazers + Fire both at Moda Center), so we key by venue
// name rather than team.
//
// Adding a new venue: add an entry below. Display falls back to a
// neutral "—" when a venue isn't yet seeded, so missing entries are
// safe but should be filled in when a team's added.
//
// Pricing reflects typical drive-up rates for game day, not pre-paid
// SpotHero deals (which can be 30-50% cheaper). Update if a venue
// changes its rate structure materially.

export interface VenueLogistics {
  parking: {
    /** Typical drive-up price in USD. Use 0 with `free: true` for free lots. */
    typical: number;
    /** Optional display range like "10-25" — shown when there's wide variance. */
    range?: string;
    free?: boolean;
  };
  transit: {
    available: boolean;
    /** "excellent" = stop at the door, "good" = short walk, "limited" = exists but indirect, "none" = drive only */
    rating: 'excellent' | 'good' | 'limited' | 'none';
    /** User-facing one-liner shown next to the parking row. Keep brief. */
    notes: string;
  };
}

const VENUE_LOGISTICS: Record<string, VenueLogistics> = {
  // ── Detroit area ──────────────────────────────────────────────────────
  'Comerica Park': {
    parking: { typical: 20, range: '10-30' },
    transit: { available: true, rating: 'good', notes: 'People Mover to Times Square (free)' },
  },
  'Little Caesars Arena': {
    parking: { typical: 30, range: '20-40' },
    transit: { available: true, rating: 'good', notes: 'People Mover to Grand Circus (free)' },
  },
  'Van Andel Arena': {
    parking: { typical: 10, range: '5-15' },
    transit: { available: true, rating: 'limited', notes: 'DASH bus runs nearby' },
  },
  'Fifth Third Field (Toledo)': {
    parking: { typical: 8, range: '5-10' },
    transit: { available: false, rating: 'none', notes: '' },
  },
  'UPMC Park': {
    parking: { typical: 0, free: true },
    transit: { available: false, rating: 'none', notes: '' },
  },

  // ── Portland area ─────────────────────────────────────────────────────
  'Moda Center': {
    parking: { typical: 20, range: '15-30' },
    transit: { available: true, rating: 'excellent', notes: 'MAX to Rose Quarter (door)' },
  },
  'Providence Park': {
    parking: { typical: 20, range: '15-30' },
    transit: { available: true, rating: 'excellent', notes: 'MAX to Providence Park (door)' },
  },

  // ── Los Angeles area ──────────────────────────────────────────────────
  'Crypto.com Arena': {
    parking: { typical: 45, range: '30-60' },
    transit: { available: true, rating: 'good', notes: 'Metro L Line to Pico (5-min walk)' },
  },
  'Dodger Stadium': {
    parking: { typical: 30 },
    transit: { available: true, rating: 'good', notes: 'Free Dodger Stadium Express from Union Station' },
  },
  'UNIQLO Field at Dodger Stadium': {
    parking: { typical: 30 },
    transit: { available: true, rating: 'good', notes: 'Free Dodger Stadium Express from Union Station' },
  },
  'Angel Stadium': {
    parking: { typical: 12, range: '10-15' },
    transit: { available: true, rating: 'good', notes: 'Metrolink to Anaheim (10-min walk)' },
  },
  'Honda Center': {
    parking: { typical: 20 },
    transit: { available: true, rating: 'good', notes: 'Metrolink to ARTIC (10-min walk)' },
  },
  'SoFi Stadium': {
    parking: { typical: 75, range: '50-100' },
    transit: { available: true, rating: 'good', notes: 'Metro K Line + free shuttle from Hawthorne/Lennox' },
  },
  'BMO Stadium': {
    parking: { typical: 35, range: '25-50' },
    transit: { available: true, rating: 'excellent', notes: 'Metro E Line to Expo Park/USC (5-min walk)' },
  },
  'Dignity Health Sports Park': {
    parking: { typical: 25, range: '20-30' },
    transit: { available: true, rating: 'limited', notes: 'Bus from Carson Metro station' },
  },
};

export function getVenueLogistics(venueName: string | null | undefined): VenueLogistics | null {
  if (!venueName) return null;
  // Exact match first
  if (VENUE_LOGISTICS[venueName]) return VENUE_LOGISTICS[venueName];
  // Fall back to a case-insensitive prefix match — handles minor naming
  // variations (e.g. "Crypto.com Arena (Premier)" → "Crypto.com Arena").
  const lower = venueName.toLowerCase();
  for (const [key, val] of Object.entries(VENUE_LOGISTICS)) {
    if (lower.startsWith(key.toLowerCase()) || key.toLowerCase().startsWith(lower)) {
      return val;
    }
  }
  return null;
}
