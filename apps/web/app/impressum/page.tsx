import { LegalPage, legalMetadata } from '@/components/marketing/legal-page';

export const generateMetadata = () => legalMetadata('impressum');
export default function Page() { return <LegalPage doc="impressum" />; }
