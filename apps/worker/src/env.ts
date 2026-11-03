// Root-.env laden – muss vor @opengeo/db importiert werden (der DB-Pool liest DATABASE_URL beim Import).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
// bereits gesetzte Variablen (z. B. OPENGEO_MOCK_ENGINES=1 aus der Shell) haben Vorrang
dotenv.config({ path: path.join(repoRoot, '.env'), quiet: true });
