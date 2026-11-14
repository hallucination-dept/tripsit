# Bind evidence and decisions to exact revisions

Status: proposed technical design implementing the agreed accountability direction.

New PRs require fresh verification and sign-off. Within a PR, retain original execution records and explicitly assess whether unaffected evidence applies to a new candidate; rerun affected checks, and rerun required checks in full when impact is unknown. Human acceptance does not silently transfer between SHAs.

Compared with caching by filename or PR number, this costs more execution and provenance storage but avoids presenting evidence for an earlier version as verification of new code. Unknown impact remains visible even after all available checks pass.
