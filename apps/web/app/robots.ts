import type { MetadataRoute } from 'next';
import { isHosted, publicUrl } from '@askmetry/core/hosted/config';

// Zur Laufzeit erzeugen (ASKMETRY_HOSTED wird erst beim Start gesetzt, nicht beim Build)
export const dynamic = 'force-dynamic';

/** Gehostet: Startseite und Rechtsseiten indexierbar, App-, Check- und Kaufseiten nicht. Selbst gehostet: nichts indexieren. */
export default function robots(): MetadataRoute.Robots {
  if (!isHosted()) return { rules: { userAgent: '*', disallow: '/' } };
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/w/', '/check/', '/kasse', '/api/', '/login', '/signup'] },
    sitemap: `${publicUrl()}/sitemap.xml`,
  };
}
