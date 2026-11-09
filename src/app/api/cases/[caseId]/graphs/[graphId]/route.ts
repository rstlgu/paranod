import { NextResponse } from 'next/server';

export async function DELETE() {
  return NextResponse.json(
    {
      error:
        'Every graph must belong to a case. Move or delete the graph instead.'
    },
    { status: 409 }
  );
}
