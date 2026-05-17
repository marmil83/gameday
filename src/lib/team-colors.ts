// Team brand colors — used for the thin accent bar at the top of each
// GameCard so a Tigers game looks instantly different from a Thorns one.
// Pulled from official team identity guidelines / Wikipedia. Picking the
// PRIMARY brand color (the one most associated with the team in fan
// merch / uniforms), not the lightest accent.
//
// Keyed by canonical team name (matches teams.name in Supabase). Falls
// back to a neutral grey if a team isn't listed — additive change, no
// data is broken by a miss.

const TEAM_COLORS: Record<string, string> = {
  // MLB
  'Detroit Tigers':          '#0C2340', // navy
  'Los Angeles Angels':      '#BA0021', // angels red
  'Los Angeles Dodgers':     '#005A9C', // dodger blue
  // MiLB
  'Toledo Mud Hens':         '#003931', // green
  'Erie SeaWolves':          '#B33C2A', // brick red
  'Hillsboro Hops':          '#1F5C2E', // hops green
  // NHL
  'Detroit Red Wings':       '#CE1126', // wings red
  'Los Angeles Kings':       '#111111', // black
  'Anaheim Ducks':           '#F47A38', // ducks orange
  // NBA
  'Detroit Pistons':         '#1D42BA', // pistons blue
  'Portland Trail Blazers':  '#E03A3E', // blazer red
  'Los Angeles Lakers':      '#552583', // lakers purple
  'LA Clippers':             '#C8102E', // clippers red
  // NFL
  'Detroit Lions':           '#0076B6', // honolulu blue
  'Los Angeles Rams':        '#003594', // rams royal
  'Los Angeles Chargers':    '#0080C6', // powder blue
  // MLS
  'Portland Timbers':        '#00482B', // forest green
  'LA Galaxy':               '#00245D', // galaxy navy
  'Los Angeles FC':          '#C39E6D', // lafc gold
  // NWSL
  'Portland Thorns FC':      '#871829', // thorns red
  'Angel City FC':           '#DAA1A1', // sol rosa
  // WNBA
  'Los Angeles Sparks':      '#552583', // sparks purple
  'Chicago Sky':             '#418FDE', // sky blue
  // AHL
  'Grand Rapids Griffins':   '#CC0033', // griffins red
  // WHL
  'Portland Winterhawks':    '#B71234', // hawks red
  // USL
  'Detroit City FC':         '#6E2F23', // rouge maroon
};

const DEFAULT_ACCENT = '#86868b'; // Apple-grey fallback — quiet, never wrong

export function teamColor(teamName: string | null | undefined): string {
  if (!teamName) return DEFAULT_ACCENT;
  return TEAM_COLORS[teamName] || DEFAULT_ACCENT;
}
