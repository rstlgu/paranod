'use client';

import { useRouter } from 'next/navigation';
import { CaseDetailContent } from './case-detail-content';

export function CasePage({ caseId }: { caseId: string }) {
  const router = useRouter();

  return (
    <CaseDetailContent
      caseId={caseId}
      onOpenGraph={(graphId, title) =>
        router.push(
          `/?open=graph:${graphId}&title=${encodeURIComponent(title ?? 'Graph')}`
        )
      }
      onOpenNote={(currentCaseId, noteId, title) =>
        router.push(
          `/?open=note:${currentCaseId}/${noteId}&title=${encodeURIComponent(title ?? 'Note')}`
        )
      }
    />
  );
}
