# Warhammer Calculator web application

This directory contains the browser, static agent-query, and worker API surfaces
for Warhammer Calculator. The calculation engine is compiled from the repository
owner's C code to WebAssembly. The surrounding site and integration work are
AI-assisted.

## Requirements

- Node.js 22.13 or newer
- the checked `public/wasm/calculator.js` and `calculator.wasm` artifacts

## Commands

```sh
npm ci
npm test
npm run lint
npm run format:check
npm run test:fixtures
npm run test:pages
```

`npm test` builds the production application and runs the browser, API,
WebAssembly differential, battle replay, migration, source-lock, and golden
fixture suites.

## Battle replay

Guided Play stores an append-only, versioned battle history. Version 43 includes
source-locked Waaagh!, Grim Resolve, Oath of Moment, and Necrons Reanimation
Protocols transitions. Reanimation activations use secure D3 rolls and resolve
one wound at a time. The API selects the same transitions into the native replay
ABI, so JavaScript and C/WebAssembly must agree before a replay is accepted.

Profile and battle-rule data are generated from the repository's pinned source
manifests. Regenerate data and Wasm from the repository root; do not hand-edit
published JSON or compiled Wasm artifacts.

## Local development

```sh
npm run dev
```

The production build uses vinext. `.openai/hosting.json` defines the Sites
deployment bindings, and the worker implementation is in `worker/index.ts`.
