# Task 9: Built-in Tool Expectation Fix

Status: DONE

## Change

Updated `packages/core/test/location-layer.test.ts` to include the canonical `get_task_output` tool in the blocked and allowed location tool-list expectations. No production code or registry entries changed.

## TDD Evidence

The focused test was run before the change and failed because the actual list included `get_task_output` while the expected list did not. After the expectation update, the focused test passed.

## Verification

From `packages/core`:

```powershell
bun test --timeout 90000 test/location-layer.test.ts
# 7 pass, 0 fail
bun typecheck
# pass
bun test --timeout 90000
# 1420 pass, 7 skip, 0 fail
```

## Concerns

The full suite logged an expected simulated skill-download HTTP error during a test, but exited successfully. Pre-existing untracked planning documents were left unchanged.
