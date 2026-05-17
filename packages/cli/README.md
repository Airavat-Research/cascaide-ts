[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

# cascaide-ts 

Cascaide is a fullstack agent runtime and AI orchestration framework written in typescript designed to run anywhere JS/TS can. It was originally built for web applications but works equally well for headless/CLI AI agents and workflows in javascript runtimes.

What it really is is a distributed, observable, durable graph executor. The first split just happens to be client/server, hence full stack.

To learn more about how to use Cascaide, check out the docs. Cascaide was built with developer experience at its core. As you read through the docs, you will see that you can accomplish a surprising amount of work with plain programmatic control. Complexity arises from composing simple primitives and the abstractions will feel familiar.

## Full Stack Quickstart

Get started quickly by building a full-stack cascaide application using the create-cascaide-app CLI:

```bash
npx create-cascaide-app@latest
```

The CLI sets up a full stack AI application with 3 agents 

- ReAct Agent with search capabilities
- Hotel Booking Agent(Supervisor) with two sub agents and two HITL steps
- Recursive ReAct Agent with search capabilities that can recursively invoke itself to handle complex tasks. Each fresh instance at every recursion depth is trackable via mini chat windows

CLI currently gives you apps in

- NextJS
- React + Hono
- React + Fastify
- React + Express

For both Cascaide and Cascaide Lite (more below).
