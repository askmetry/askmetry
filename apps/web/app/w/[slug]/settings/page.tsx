import { SettingsHashRedirect } from '@/components/settings-hash-redirect';

/** Alte Adresse /settings (auch mit #messen usw.) → passende Unterseite. */
export default async function SettingsIndex({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <SettingsHashRedirect slug={slug} />;
}
