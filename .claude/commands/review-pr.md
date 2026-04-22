Review the PR: $ARGUMENTS

## Before reviewing, build context
Read the following to understand the project before evaluating the PR:
- `CLAUDE.md` — project conventions and architecture overview
- `README.md` — high-level purpose and structure  
- `backend/` — FastAPI app structure, routers, models, schemas, services
- `frontend/src/` — React/TypeScript component and hook patterns
- Any existing utility/helper modules to understand what shared code already exists

The goal is to evaluate the PR *in context* — not just whether the changed files are internally clean, but whether they fit the project's existing patterns, reuse available abstractions, and are consistent with conventions elsewhere.

## Review criteria
- **Consistency**: Does the PR follow patterns established elsewhere in the codebase?
- **Reuse**: Are there existing utilities, hooks, components, or helpers that should have been used?
- **Conciseness & simplicity**: Is the code as simple as it could be given the broader design?
- **Extensibility**: Does it fit cleanly into the existing architecture?
- **Unused code**: Any unused imports, functions, or dead code introduced or left behind?
- **Iteration residue**: PRs often go through several rounds of back-and-forth. Look for code that made sense in an earlier iteration but is now suboptimal given the final shape — over-defensive checks for cases that can't happen, abstractions introduced for a design that was later simplified, variables or helpers that are now only used once, comments referencing earlier behavior. Ask "given the final state, would this still be written this way?"
- **Optimisations**: Anything that could be meaningfully improved in performance or structure?
- **Best practices**: Violations of Python/FastAPI/React/TypeScript conventions relevant to this codebase?

## Output structure
1. **PR summary** — what it does and how it fits into the project
2. **Context observations** — anything notable about how it relates to the wider codebase
3. **File-by-file review** — for files with significant observations
4. **Priority issues** — should be addressed before merge
5. **Minor suggestions** — nice-to-haves