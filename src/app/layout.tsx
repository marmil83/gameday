import type { Metadata } from "next";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${spaceGrotesk.variable} h-full antialiased`}>
      {/* Dark base bg prevents a white flash before client hydration on
          the dark-themed game list. */}
      <body className="min-h-full flex flex-col font-sans" style={{ background: '#0a0a0d', color: '#fafafa' }}>
        {children}
      </body>
    </html>
  );
}
