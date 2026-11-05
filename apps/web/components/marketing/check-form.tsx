// URL-Feld der Startseite (Hero und Abschluss). Server-Komponente: liest den Turnstile-Site-Key und rendert das Formular.
import { hostedConfig } from '@askmetry/core/hosted/config';
import { CheckFormClient } from './check-form-client';

/** URL-Feld mit „Gratis prüfen“. Props wie bisher; der Bot-Schutz (Turnstile) kommt automatisch dazu, sobald ein Site-Key gesetzt ist. */
export function CheckForm(props: { id?: string; size?: 'lg' | 'md'; tone?: 'default' | 'onCard' }) {
  return <CheckFormClient {...props} siteKey={hostedConfig().turnstile.siteKey ?? null} />;
}
