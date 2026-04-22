# Testing

Always use the Makefile to run tests. Do not run `pytest`, `vitest`, or `mypy` directly.

- `make test-backend` — backend pytest (runs in the `test` docker compose profile)
- `make test-frontend` — frontend vitest (installs deps if needed, then `npm run test:run`)
- `make typecheck` — mypy for the backend
- `make check` — all three
