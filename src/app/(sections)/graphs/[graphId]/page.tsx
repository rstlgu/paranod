import { redirect } from 'next/navigation';

export const metadata = {
  title: 'Paranod | Graph Editor'
};

type PageProps = {
  params: Promise<{ graphId: string }>;
};

export default async function Page(props: PageProps) {
  const params = await props.params;
  redirect(`/?open=graph:${params.graphId}`);
}
