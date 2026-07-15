# Task 3 implementation report

## TDD record

- Original RED: `node --test tests/class-admin-api.test.js` ran 6 tests with 0 passing and 6 failing. The three new class admin routes returned HTTP 404, the student listing did not expose/filter/order class assignments, invalid class duties were imported, and the grouped class UI contract was absent.
- Intermediate full-suite issue: after the focused tests became green, `npm test` initially reported 5 failures because `tests/run-all.js` loaded stateful fixture suites concurrently in one process. The new class API suite now runs in an isolated child process, preserving existing shared-memory fixtures.
- Final focused GREEN: `node --test tests/class-admin-api.test.js` passed 6/6.
- Final required verification: `node --test tests/class-admin-api.test.js tests/site-smoke.test.js && npm run check` passed 19/19 focused/smoke tests, all syntax checks, the isolated Task 3 suite 6/6, and the existing full suite 55/55.
- Hygiene: `git diff --check` passed. The two deployed stylesheet copies are byte-identical.

## Implementation

- Added privacy-safe class list, assignment and synchronization admin APIs for normal and super administrators without exposing a platform-role escalation path.
- Extended identity listing with class identifiers, duty, stable school/college/class/duty/name ordering, class filters, pagination continuation metadata, and masked phones.
- Extended identity import with `班级职务` and `关联班级`, role-aware validation, explicit class assignments, and row-specific errors.
- Added adjacent class headings, member counts, `接上页` markers, class filters, sync controls, student duty selectors and teacher assignment controls, including responsive mobile styling.
- Registered the Task 3 test in the full runner using process isolation so existing role-filter, pagination and smoke coverage remains stable.

## Residual risk

- MySQL/TiDB behavior is covered through the existing store contract and query-oriented tests, while the focused HTTP test uses the in-memory test backend. A staging smoke test against a production-shaped database is still recommended before release.

## Independent review fix cycle

### RED evidence

- `node --test tests/class-admin-api.test.js tests/class-store.test.js` initially ran 36 tests with 26 passing and 10 failing.
- The failures demonstrated cross-class student assignment, duplicate-school identity ambiguity, misleading partial-import totals, omitted-role overwrite, collapsed teacher assignments, unfiltered role counts, ambiguous unassigned continuation, leaked sync diagnostics, and missing frontend stable-identity wiring.

### GREEN evidence

- `node --test tests/class-domain.test.js tests/class-store.test.js tests/class-admin-api.test.js` passed 43/43 after the fixes.
- The expanded regression set includes a fake MySQL pool/SQL-contract case, duplicate student numbers across schools, truthful partial imports, teacher multi-class add/remove behavior, filtered role counts, pagination continuation, and frontend interaction/event wiring.
- `node --test tests/class-domain.test.js tests/class-store.test.js tests/class-admin-api.test.js tests/site-smoke.test.js && npm run check` completed successfully.
- `npm run check` passed syntax checks and the complete `npm test` suite at 59/59.
- `git diff --check` passed, and `public/assets/styles.css` remains byte-identical to `public/assets/styles-v157.css`.

### Changed behavior

- A student can hold only the active class assignment matching the normalized school, college, and class identity; replacement is atomic and cross-identity class ids are rejected.
- Account status, platform role, and password-reset actions use stable user id plus school/student number fallback, so duplicate student numbers across schools remain unambiguous.
- Identity imports report persisted identities independently from class-assignment failures, preserve omitted existing roles consistently in memory and MySQL paths, and protect privileged roles from normal-admin overwrite.
- Teacher accounts expose every active class assignment and support explicit assignment removal without collapsing the UI to the first class.
- Class ordering includes platform role tier, role counts honor active class filters, sync responses hide internal diagnostics, and unassigned pagination uses the `__unassigned__` sentinel.
