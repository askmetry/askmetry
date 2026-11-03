import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'OpenGEO', template: '%s · OpenGEO' },
  description: 'Sichtbarkeit deiner Marke in KI-Suchmaschinen messen',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body className="min-h-screen font-sans text-[15px]">{children}</body>
    </html>
  );
}
