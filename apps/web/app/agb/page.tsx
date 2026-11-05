import { LegalPage, legalMetadata } from '@/components/marketing/legal-page';

export const generateMetadata = () => legalMetadata('agb');
export default function Page() { return <LegalPage doc="agb" />; }
