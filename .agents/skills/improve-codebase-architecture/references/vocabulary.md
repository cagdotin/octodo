# Architecture vocabulary

Use these terms exactly. Consistent language is the point: don't substitute "component", "API", or "boundary".

## Terms

- **Module:** anything with an interface and an implementation, at any scale: a function, a file, an Effect service, a package, or a slice that spans server and web. In this repo an Effect service (`Workspace`, `Workspaces`) is a module; say "the Workspace service" when you mean that service, and "module" for the architecture.
- **Interface:** everything a caller must know to use the module correctly. The type signature, and also invariants, ordering constraints, error modes (the `TaggedError`s in the error channel), required layers and configuration, and performance characteristics. Not just the TypeScript `interface` keyword.
- **Implementation:** the code inside a module. Distinct from an adapter: a small adapter can have a large implementation (the file-backed workspace), and a large adapter a small one (an in-memory fake).
- **Depth:** leverage at the interface. How much behavior a caller or test can exercise per unit of interface it has to learn. A module is **deep** when a lot of behavior sits behind a small interface, and **shallow** when the interface is nearly as complex as the implementation.
- **Seam** (Michael Feathers): a place where you can change behavior without editing that place; the location where a module's interface lives. Where the seam goes is a decision of its own, separate from what goes behind it.
- **Adapter:** a concrete thing that satisfies an interface at a seam. It names a role, not a substance. In Effect, a `Layer` is usually the adapter: the live layer in production, a test layer in tests.
- **Leverage:** what callers get from depth. More capability per unit of interface they learn, paid back across every call site and test.
- **Locality:** what maintainers get from depth. Change, bugs, knowledge and verification concentrate in one place instead of spreading across callers. Fix it once and it is fixed everywhere.

## Principles

- **Depth is a property of the interface, not the implementation.** A deep module can be built from small, swappable parts inside it. They just aren't part of its interface. A module can have internal seams, used by its own tests, as well as the external seam at its interface.
- **The deletion test.** Imagine deleting the module. If the complexity vanishes, it was a pass-through. If it reappears across many callers, the module was earning its keep.
- **The interface is the test surface.** Callers and tests cross the same seam. If a test needs to reach past the interface, the module is probably the wrong shape.
- **One adapter is a hypothetical seam. Two adapters is a real one.** Don't introduce a seam unless something actually varies across it, typically production and test.

When shaping an interface, ask: can it have fewer entry points, simpler parameters, more hidden inside?

For testability, a module accepts its dependencies instead of creating them (in Effect, it requires a service instead of constructing one), and returns results instead of mutating its inputs.

## Dependency categories

When assessing a candidate, classify each dependency. The category decides how the deepened module is tested across its seam.

1. **In-process.** Pure computation and in-memory state, no I/O. Always deepenable: merge the modules and test through the new interface directly. No adapter.
2. **Local-substitutable.** Dependencies with a local stand-in. Here that is mostly the file system: a scratch directory, or Effect's `FileSystem` with a test layer. Test the deepened module against the stand-in. The seam stays internal.
3. **Remote but owned.** Our own code across a process or network hop: the web app talking to the server over the typed fetch client, the SSE change feed, MCP clients, Electron's main and renderer processes. Put a port at the seam. The deep module owns the logic and the transport is an injected adapter: HTTP in production, in-memory in tests.
4. **Truly external.** Things we don't control: the OS file watcher, Electron and browser APIs. The deepened module takes them as an injected port, and tests supply a fake.

## Testing: replace, don't layer

- Once tests exist at the deepened module's interface, the old unit tests on the shallow modules are waste. Delete them.
- Write the new tests at the deepened interface, and assert on observable outcomes (the files on disk, the returned value, the error), not internal state.
- A test that has to change when the implementation changes is testing past the interface.

## Framings to avoid

- **Depth as a ratio of implementation lines to interface lines.** It rewards padding. Depth here is leverage.
- **"Interface" as only the type signature or public methods.** Too narrow. The interface is every fact a caller must know.
- **"Boundary".** Overloaded. Say seam or interface.
