# @cascaide-ts/server-fastify

Cascaide is a fullstack agent runtime and AI orchestration framework in typescript.

`cascaide-ts/server-fastify` provides the fastify backend adapter for cascade executions. Used to create the action and persistence api routes.

## Installation

```bash
npm i @cascaide-ts/server-fastify
```

## Example Use

```ts 
import { serverWorkflowConfig } from '@/graphs/server/config';
import { createWorkflowHandler} from '@cascaide-ts/server-fastify';

export const POST =  createFastifyWorkflowHandler(serverWorkflowConfig);
```

```ts
import { createPersistenceHandler } from '@cascaide-ts/server-fastify';
import { PostgresPersistor } from '@cascaide-ts/postgres-js';
import { sql } from '@/lib/pglite';

const persistor = new PostgresPersistor(sql);
export const POST =createPersistenceHandler(persistor);

```

## Additional Resources

[React + fastify Quickstart](https://www.cascaide-ts.com/docs/QuickStart/fastify)
