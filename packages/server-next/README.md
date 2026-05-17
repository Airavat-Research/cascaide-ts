# @cascaide-ts/server-next

Cascaide is a fullstack agent runtime and AI orchestration framework in typescript.

`cascaide-ts/server-next` provides the NextJS backend adapter for cascade executions. Used to create the action and persistence api routes.

## Installation

```bash
npm i @cascaide-ts/server-next
```

## Example Use

```ts 
import { serverWorkflowConfig } from '@/graphs/server/config';
import { createWorkflowHandler} from '@cascaide-ts/server-next';

export const POST =  createWorkflowHandler(serverWorkflowConfig);
```

```ts
import { createPersistenceHandler } from '@cascaide-ts/server-next';
import { PostgresPersistor } from '@cascaide-ts/postgres-js';
import { sql } from '@/lib/pglite';

const persistor = new PostgresPersistor(sql);
export const POST =createPersistenceHandler(persistor);

```

## Additional Resources

[React + next Quickstart](https://www.cascaide-ts.com/docs/QuickStart/NextJS)
