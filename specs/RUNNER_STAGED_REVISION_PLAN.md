# Runner staged revision validation

Add an optional exact-revision request mode while preserving the existing partial-file protocol. The new mode validates complete Git tree and commit identities against the frozen base before sandbox creation; unsupported trees fail closed. Echo the verified revision only for this mode. Preserve all isolation controls and do not execute repository code in tests.

- Validate bounded UTF-8 files, executable modes, blob hashes, tree reconstruction, sole parent and exact commit bytes. Verify: `python3 -m unittest discover -s tests -p 'test_runner.py'`.
- Confirm the coordinator echoes the verified revision only for complete requests and preserves legacy output. Verify: `python3 -m unittest discover -s tests -p 'test_runner.py'`.
- Run offline Python regression tests and `git diff --check`; no deployment or live services.
