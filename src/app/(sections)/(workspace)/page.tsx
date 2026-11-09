import { WorkspaceView } from '@/features/workspace/components/workspace-view';

export const metadata = {
  title: 'Workspace'
};

export default function Page() {
  return (
    <div className='relative flex min-h-0 flex-1 overflow-hidden'>
      <WorkspaceView />
    </div>
  );
}
