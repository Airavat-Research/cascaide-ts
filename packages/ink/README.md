# @cascaide-ts/react

Cascaide is a fullstack agent runtime and AI orchestration framework in typescript designed to run anywhere JS/TS can. It was originally built for web applications but works equally well for headless/CLI AI agents and workflows in javascript runtimes.

What it really is is a distributed, observable, durable graph executor. The first split just happens to be client/server, hence full stack.

`@cascaide-ts/ink` is the Ink adapter layer and provides

- `WorkflowProvider` : Sets up the client side state and runtime
- `WorkflowRenderer` : Renders the right UI nodes as you spawn them
- `useWorkflow` : Hook to control graph execution
- `useCascade` : Hook to observe graph execution

It is almost identical to `@cascaide-ts/react` with some minor differences.

## Installation

```bash
npm i @cascaide-ts/ink
```

## Additional Resources

[Quickstart](https://www.cascaide-ts.com/docs/QuickStart/overview)
[Provider and Renderer](https://www.cascaide-ts.com/docs/Learn/provider_renderer)
[Hooks](https://www.cascaide-ts.com/docs/Learn/hooks)