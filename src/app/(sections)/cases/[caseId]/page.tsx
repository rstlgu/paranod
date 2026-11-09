import { CasePage } from '@/features/cases/components/case-page';

export const metadata = {
  title: 'Case'
};

type PageProps = {
  params: Promise<{ caseId: string }>;
};

export default async function Page(props: PageProps) {
  const { caseId } = await props.params;
  return <CasePage caseId={caseId} />;
}
