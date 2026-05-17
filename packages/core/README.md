# @cascaide-ts/core


The core engine that powers Cascaide applications. 

Cascaide is a fullstack agent runtime and AI orchestration framework in typescript designed to run anywhere JS/TS can. It was originally built for web applications but works equally well for headless/CLI AI agents and workflows in javascript runtimes.

What it really is is a distributed, observable, durable graph executor. The first split just happens to be client/server, hence full stack.

## Installation

`@cascaide-ts/core` is the package all other packages depend on. You will be using it with other packages like `@cascaide-ts/react` to build your full stack AI applications.

```bash
npm install @cascaide-ts/core
```

In your codebase itself, you will be mostly using `core` for the types.

| Package | Role |
|---|---|
| [`@cascaide-ts/helpers`](https://github.com/Airavat-Research/cascaide-ts/tree/master/packages/helpers) | Agent factories (`createReactAgent`, `createSupervisorAgent`, …) and LLM utilities |
| [`@cascaide-ts/react`](https://github.com/Airavat-Research/cascaide-ts/tree/master/packages/react) | Client-side runtime: `WorkflowProvider`, `WorkflowRenderer`, hooks |
| [`@cascaide-ts/postgres-js`](https://github.com/Airavat-Research/cascaide-ts/tree/master/packages/postgres-js) | Postgres `Persistor` for durable cascades |
| [`@cascaide-ts/server-next`](https://github.com/Airavat-Research/cascaide-ts/tree/master/packages/server-next) | Next.js adapter |
| [`@cascaide-ts/server-hono`](https://github.com/Airavat-Research/cascaide-ts/tree/master/packages/server-hono) | Hono adapter |
| [`@cascaide-ts/server-fastify`](https://github.com/Airavat-Research/cascaide-ts/tree/master/packages/server-fastify) | Fastify adapter |
| [`@cascaide-ts/server-express`](https://github.com/Airavat-Research/cascaide-ts/tree/master/packages/server-express) | Express adapter |
| [`@cascaide-ts/cli`](https://github.com/Airavat-Research/cascaide-ts/tree/master/packages/cli) | `npx create-cascaide-app` — scaffold a working app in one command |
 
---


## Additional Resources

[Introduction](https://www.cascaide-ts.com/docs/introduction)
[Quickstart](https://www.cascaide-ts.com/docs/QuickStart/overview)
[Basic Concepts](https://www.cascaide-ts.com/docs/Learn/basic_concepts)
