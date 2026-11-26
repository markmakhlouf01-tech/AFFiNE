# AFFiNE fork — contributor guide

AFFiNE is a docs + whiteboard + database workspace. TypeScript monorepo (Yarn 4 workspaces) with
Rust native modules. The editor engine is BlockSuite (`blocksuite/`).
Upstream: toeverything/AFFiNE — this repo is a fork.

## Layout

- `blocksuite/` — editor framework and blocks (`affine/`, `framework/`, `playground/`, `integration-test/`).
- `packages/frontend/` — `core` (most app logic), `component` (UI kit), `apps/*` (web, electron,
  mobile, ios, android), `i18n`, `native` (Rust → Node via NAPI-RS).
- `packages/backend/server` — NestJS + Prisma + GraphQL server (cloud features); `native` — its Rust module.
- `packages/common/` — shared libs (`nbstore` storage, `infra`, `graphql`, `env`, `auth` …).
- `tests/` — Playwright e2e suites (`affine-local`, `affine-cloud`, `affine-mobile`, `blocksuite`).
- `tools/` — the `yarn affine` CLI and build tooling. `docs/` — BUILDING.md, server and desktop guides.

## Setup

Node 22 (`.nvmrc`; `>=22.12 <23`), Yarn 4 via `corepack enable` (Yarn 1 won't work),
Rust per `rust-toolchain.toml`.

```bash
yarn install                          # also runs `yarn affine init` and installs git hooks
yarn affine @affine/native build      # needed before running the app
yarn affine @affine/server-native build   # only for the server / cloud e2e
yarn dev -p @affine/web               # http://localhost:8080
```

Other dev targets: `@affine/server`, `@affine/electron`, `@affine/mobile`, `@affine/admin`.

## Checks (what CI runs)

- `yarn lint` (oxlint + oxfmt), `yarn lint:fix` to fix; `yarn typecheck`; `yarn dedupe --check`.
- Unit tests: `yarn test` (vitest; filter with `yarn vitest run <path>`).
- BlockSuite: `yarn workspace @blocksuite/integration-test test:unit`.
- E2E: `yarn affine @affine-test/affine-local e2e` (Playwright; needs a built app).
- Server: `yarn affine @affine/server test` (needs Postgres/Redis — see `docs/developing-server.md`).
- Rust: `cargo fmt`, `cargo clippy`, `yarn affine @affine/native test`.

Run the narrowest check for what you touched; the full e2e and server suites are slow and need services.

## Rules

- After changing GraphQL schema/queries run `yarn affine gql build`; after adding UI strings add them
  to `packages/frontend/i18n/src/resources/en.json` and run `yarn affine i18n build`.
- PR titles follow Conventional Commits (`feat(editor): …`, `fix(core): …`) — enforced by CI.
- Upstream PRs need the CLA signed (cla-assistant.io/toeverything/AFFiNE) with a commit email linked
  to GitHub.
- Keep changes in one package where possible; shared code goes in `packages/common`.
