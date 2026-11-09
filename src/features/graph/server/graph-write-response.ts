import { NextResponse } from 'next/server';
import { GraphWriteError } from './graph-agent-lease';

export function graphWriteErrorResponse(error: unknown) {
  if (!(error instanceof GraphWriteError)) return null;
  return NextResponse.json(
    {
      error: error.code,
      ...(error.writeState ? { writeState: error.writeState } : {})
    },
    { status: error.status, headers: { 'Cache-Control': 'private, no-store' } }
  );
}
