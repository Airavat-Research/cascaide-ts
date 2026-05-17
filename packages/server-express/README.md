# @cascaide-ts/server-express

Cascaide is a fullstack agent runtime and AI orchestration framework in typescript.

`cascaide-ts/server-express` provides the express backend adapter for cascade executions. Used to create the action and persistence api routes.

## Installation

```bash
npm i @cascaide-ts/server-express
```

## Example Use

```ts 
import { serverWorkflowConfig } from '@/graphs/server/config';
import { createWorkflowHandler} from '@cascaide-ts/server-express';

export const POST =  createExpressWorkflowHandler(serverWorkflowConfig);
```

```ts
import { createPersistenceHandler } from '@cascaide-ts/server-express';
import { PostgresPersistor } from '@cascaide-ts/postgres-js';
import { sql } from '@/lib/pglite';

const persistor = new PostgresPersistor(sql);
export const POST =createPersistenceHandler(persistor);

```

## Additional Resources

[React + Express Quickstart](https://www.cascaide-ts.com/docs/QuickStart/express)
