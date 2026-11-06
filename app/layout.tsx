import type { Metadata, Viewport } from 'next';
import { Bungee, Outfit } from 'next/font/google';
import './globals.css';

const display = Bungee({ weight: '400', subsets: ['latin'], variable: '--font-display', display: 'swap' });
const body = Outfit({ subsets: ['latin'], variable: '--font-body', display: 'swap' });

export const metadata: Metadata = {
  title: 'Nirbhay: Pen Battle',
  description: 'Flick it. Fight it. Be the last pen standing. Made for Nirbhay Rajput.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0b1f17',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
