# @cascaide-ts/helpers

Cascaide is a fullstack agent runtime and AI orchestration framework in typescript designed to run anywhere JS/TS can. It was originally built for web applications but works equally well for headless/CLI AI agents and workflows in javascript runtimes.

What it really is is a distributed, observable, durable graph executor. The first split just happens to be client/server, hence full stack.

To learn more about how to use Cascaide, check out the [docs](https://www.cascaide-ts.com/docs/introduction).

## Installation 

```bash 
npm i @cascaide-ts/helpers
```

Though we heavily recommend writing node definitions manually (because of how much you can do with programmatic control inside nodes), sometimes it's good to have helpers for common use cases.

This package contains:

## API Inventory

### Agent factories

- `createReactAgent`
- `createRecursiveReactAgent`
- `createSupervisorAgent`
- `createRecursiveSupervisorAgent`

### LLM utilities

- `callLLM`
- `toProviderHistory`
- `buildTools`
- `extractToolCalls`
- `buildToolResultMessage`
- `buildErrorToolResultMessage`
- `parseCompletedResponse`

### Core types

- `CanonicalMessage`
- `CanonicalToolCall`
- `CanonicalToolResult`
- `ToolParam`
- `ToolDefinition`
- `SubAgentDescriptor`
- `LLMProvider`
- `ReactAgentBundle`

---

## Additional Resources

[Prebuilt Agent Helpers](https://www.cascaide-ts.com/docs/Learn/helpers)