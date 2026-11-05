import { LegalPage, legalMetadata } from '@/components/marketing/legal-page';

export const generateMetadata = () => legalMetadata('unterauftragnehmer');
export default function Page() { return <LegalPage doc="unterauftragnehmer" />; }
