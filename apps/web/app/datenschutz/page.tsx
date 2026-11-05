import { LegalPage, legalMetadata } from '@/components/marketing/legal-page';

export const generateMetadata = () => legalMetadata('datenschutz');
export default function Page() { return <LegalPage doc="datenschutz" />; }
