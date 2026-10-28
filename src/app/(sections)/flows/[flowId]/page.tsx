import { redirect } from 'next/navigation';

export const metadata = {
  title: 'Paranod | Flow Editor'
};

type PageProps = {
  params: Promise<{ flowId: string }>;
};

export default async function Page(props: PageProps) {
  const params = await props.params;
  redirect(`/?open=flow:${params.flowId}`);
}
