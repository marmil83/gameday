import type { Metadata, Viewport } from "next";
import { Geist, Space_Grotesk } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// Display face for headlines + the score number. Geometric, condensed
// stroke, a hair of personality — pairs well with Geist for body text
// and reads as "younger / louder" without going full retro.
const spaceGrotesk = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "WorthGoing — Games Worth Going To",
  description: "The easiest way to decide if a game is worth going to. Curated picks, real prices, honest recommendations.",
};

// `interactive-widget=resizes-content` tells iOS Safari to actually
// SHRINK the viewport when the keyboard opens, instead of overlaying
// it on top of fixed elements. Without this, modals with input fields
// get clipped from the top because position:fixed doesn't track the
// visualViewport — the alert sign-up modal hits this exact issue.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  interactiveWidget: 'resizes-content',
  themeColor: '#0a0a0d',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${spaceGrotesk.variable} h-full antialiased`}>
      {/* Dark base bg prevents a white flash before client hydration on
          the dark-themed game list. overflow-x: hidden guards against
          any single element (long verdict, transit string, sticky-header
          city pill row) pushing the document wider than the viewport on
          narrow phones. */}
      <body
        className="min-h-full flex flex-col font-sans"
        style={{ background: '#0a0a0d', color: '#fafafa', overflowX: 'hidden' }}
      >
        {children}
      </body>
    </html>
  );
}
