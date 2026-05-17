# @cascaide-ts/server-hono

Cascaide is a fullstack agent runtime and AI orchestration framework in typescript.

`cascaide-ts/server-hono` provides the hono backend adapter for cascade executions. Used to create the action and persistence api routes.

## Installation

```bash
npm i @cascaide-ts/server-hono
```

## Example Use

```ts 
import { serverWorkflowConfig } from '@/graphs/server/config';
import { createWorkflowHandler} from '@cascaide-ts/server-hono';

export const POST =  createHonoWorkflowHandler(serverWorkflowConfig);
```

```ts
import { createPersistenceHandler } from '@cascaide-ts/server-hono';
import { PostgresPersistor } from '@cascaide-ts/postgres-js';
import { sql } from '@/lib/pglite';

const persistor = new PostgresPersistor(sql);
export const POST =createPersistenceHandler(persistor);

```

## Additional Resources

[React + hono Quickstart](https://www.cascaide-ts.com/docs/QuickStart/hono)
