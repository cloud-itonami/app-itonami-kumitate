# Agent rules for app-itonami-kumitate

- Source is Kotoba only (`kotoba/kumitate/*.kotoba`), ASCII bytes (the seed lexer refuses others). Build and test only with the pinned Amu selfhost root (README "Kotoba gate"). Do not add scittle, CLJS/CLJC/CLJK, kbb, nbb, Node, JVM, babashka, Python or C to the build or test route.
- One file is one module with its own name prefix; only `00-ns.kotoba` has an `ns` form. A new module goes into `MANIFEST` and `GATE-MANIFEST` in dependency order.
- No CI workflow: workspace CDCI is stopped. The gate is the README commands; record a run in `docs/evidence/` with the compiler hash, the unit hashes, the results and the negative controls.
- The tools are pure: they read what the caller passes. Do not add fetching (orbs, functions, remote config), a connection to CircleCI or a VCS, or job execution. External operations wait for the shared consent broker `kotoba-lang/wasm-webcomponent/src/kotoba-client-runtime.js` and the workspace end-user-app contract; never write a product-local substitute.
- Refusals carry a named code (`yaml/...`, `config/...`, `plan/...`, `expr/...`, `regex/...`, `runs/...`, `junit/...`, `xml/...`). Tests pin the code literal.
- Fixture goldens in `test/fixtures/expected/` change only together with the code that changes them, after reading the diff. Third-party configs keep their bytes; record their source in `test/fixtures/config/SOURCES.edn`.
- Track work in Linear (Kotoba Labs, JUN-346 and follow-ups).
