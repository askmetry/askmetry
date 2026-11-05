import { LegalPage, legalMetadata } from '@/components/marketing/legal-page';

export const generateMetadata = () => legalMetadata('avv');
export default function Page() { return <LegalPage doc="avv" />; }
