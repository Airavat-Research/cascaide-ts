import { NextRequest, NextResponse } from 'next/server';
import { CascadePersistence } from '@cascaide-ts/core';

export function createPersistenceHandler(persistor: CascadePersistence) {
  return async function POST(req: NextRequest) {
    const body = await req.json();
    const { action } = body;

    try {
      switch (action) { 
        case 'claim':
          return NextResponse.json(await persistor.claimNodeExecution(body));
        case 'finalize':
          return NextResponse.json(await persistor.finalizeNodeExecution(body));
        case 'error':
          return NextResponse.json(await persistor.markExecutionFailed(body.nodeInstanceId, body.cascadeId, body.error));
        case 'context':
          return NextResponse.json(await persistor.recordContextEvents(body));
        case 'hydrate':
          return NextResponse.json(await persistor.hydrateCascadeContext(body.cascadeId, body.functionId));
        case 'forkAndHydrate':
          return NextResponse.json(await persistor.forkCascadeWithContext({
              sourceCascadeId: body.sourceCascadeId,
              newCascadeId: body.newCascadeId,
              upToFunctionId: body.upToFunctionId,
            }));
        default:
          return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
      }
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }
  };
}