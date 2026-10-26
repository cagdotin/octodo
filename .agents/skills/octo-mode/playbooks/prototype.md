### Prototype

**You own the design decision, not the code. The prototype is a throwaway instrument. The real build follows Feature.**

The one playbook where the Laziness Protocol's "smallest change" and the verification bar invert. Speed over polish, code quality does not matter, no planning. The rigor is in picking the right design cheaply. Propose variations the user didn't ask for, throw an approach away and try another.

1. Scope the decision the prototype exists to make: which layout, which interaction, which density, or for an empirical fork which behavior, timing, or approach. No decision means no prototype. Route to Feature.
2. Gather references when the design space is open. TickTick, Todoist, any.do, and Linear are the products octodo competes with, so look at how they solve it. The design direction in `docs/branding.md` constrains the look. Let the user pick directions before building. Skip when the direction is set.
3. Build throwaway in a scratch dir outside `apps/` and `packages/`. For a visual decision, the lightest stack that renders the idea: plain HTML and CSS, or a scratch route in the Vite app that you delete afterwards. For a behavioral or timing decision, the smallest script that exercises the question, such as a Node script against a scratch workspace. No tests, no abstractions.
4. When comparing alternatives, build them behind one switcher (buttons or a keypress), each variant labeled. This is the **principle-exhaust-the-design-space** skill made cheap.
5. Observe the thing you are deciding. For a visual decision, screenshot each variant and drive the interaction with your harness's browser tool. For a behavioral or timing decision, log the timing, print the output, or watch the files change. The observation is the test here, not an assertion.
6. Present alternatives, tradeoffs, and a recommendation. The output is the decision plus the throwaway artifact, not shippable code. Hand the chosen direction to **Feature** (or **architect** for the shape) for the real build.

**Reply:** the variants explored, the evidence (screenshots, or the observed output or timing), tradeoffs, your recommendation, and the scratch path. Say plainly that the prototype is throwaway.
