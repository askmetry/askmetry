// Wörterbücher. Deutsch ist die Quelle; `Messages` ist sein Typ – ein fehlender oder überzähliger englischer Schlüssel
// (oder eine abweichende Funktions-Signatur) ist ein Typfehler. Je Bereich eine Datei (messages/<sprache>/<bereich>.ts).
import type { Locale } from '../config';
import { de, type Messages } from './de';
import { en } from './en';

export type { Messages };
export const messages: Record<Locale, Messages> = { de, en };
