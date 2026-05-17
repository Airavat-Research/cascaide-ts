# @cascaide-ts/postgres-js

Cascaide is a fullstack agent runtime and AI orchestration framework in typescript.

`cascaide-ts/postgres-js` provides the postgres backed durability layer for cascade executions. Used to create the persistence api route.


## Installation 

```bash 
npm i @cascaide-ts/postgres-js
```

## Example Use

```ts 
import { createPersistenceHandler } from '@cascaide-ts/server-next';
import { PostgresPersistor } from '@cascaide-ts/postgres-js';
import { sql } from '@/lib/pglite';

const persistor = new PostgresPersistor(sql);
export const POST =createPersistenceHandler(persistor);

```

## Additional Resources

[Pesistence Concepts](https://www.cascaide-ts.com/docs/capabilities/persistence)
[Persistence Setup](https://www.cascaide-ts.com/docs/QuickStart/db)