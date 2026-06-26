import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Alara Home Care',
  description: 'Expert home health care for families navigating complex situations — EEOICPA, VA, OWCP, and more.',
  openGraph: {
    title: 'Alara Home Care',
    description: 'Someone is already working on it.',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
