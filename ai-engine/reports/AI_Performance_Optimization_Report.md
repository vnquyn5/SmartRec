# SMARTREC — AI PERFORMANCE OPTIMIZATION REPORT

## 1. Scope

Task: [AI] Đo đạc Latency tổng luồng Workspace và tối ưu hóa thời gian trích xuất metadata Explainability.

This report covers AI Engine explainability metadata processing.
It does not claim complete Workspace upload-to-render measurements.

## 2. Environment

- Baseline commit: `5c1d01c`
- Optimized working tree based on: `5c1d01c` (uncommitted changes)
- Python: `3.11.16`
- Platform: `macOS-26.3.1-arm64-arm-64bit`
- Timer: `perf_counter_ns`
- Concurrency for scaling baseline: 1
- Warm-up iterations: 5
- Samples: Small=100, Medium=100, Large=30
- Benchmark input: deterministic synthetic transcript evidence and Action Items
- Model inference: excluded
- GPU testing: not performed
- Artifact persistence I/O: excluded from these measurements

## 3. Workload Definitions

| Workload | Evidence Segments | Action Items |
|---|---:|---:|
| Small | 1 | 1 |
| Medium | 100 | 8 |
| Large | 400 | 32 |

## 4. Identified Bottleneck

Static analysis and cProfile identified repeated text normalization
and assignment-cue detection inside deadline/evidence consistency checks.

Observed in the Large workload profiling:

- `_deadline_refs_are_linked()`: 38,369 calls in the profiled full pipeline.
- `_normalize()`: 77,208 calls.
- `_has_assignment_cue()`: 39,793 calls.
- Full pipeline profiling: 3.374 seconds with instrumentation overhead.

These cumulative profiling durations are not comparable to wall-clock P50/P95.

## 5. Optimization

Implemented request-scoped text caching in
`app/services/meeting_summary_evidence.py`.

The cache avoids repeated normalization and assignment-cue detection for
identical text during one evidence consistency evaluation.

The implementation does not use global/shared caches and preserves the
existing deadline-linking rules and public function behavior.

## 6. Before/After Results

All latency values are in milliseconds.

| Workload | Stage | Samples | Before P50 | After P50 | Before P95 | After P95 | P50 Speedup |
|---|---|---:|---:|---:|---:|---:|---:|
| small | summary_validation | 100 | 1.0410 | 0.7716 | 1.9344 | 1.8081 | 1.35× |
| small | evidence_consistency | 100 | 0.4054 | 0.4618 | 0.9113 | 3.0235 | 0.88× |
| small | evidence_assessment | 100 | 0.1092 | 0.0757 | 0.2684 | 0.1181 | 1.44× |
| small | explainability_builder | 100 | 0.0054 | 0.0053 | 0.0236 | 0.0079 | 1.02× |
| small | full_explainability_pipeline | 100 | 1.7418 | 1.3378 | 4.0330 | 2.5986 | 1.30× |
| medium | summary_validation | 100 | 58.8049 | 40.1944 | 61.4922 | 40.6774 | 1.46× |
| medium | evidence_consistency | 100 | 28.8647 | 9.8495 | 30.7995 | 9.9030 | 2.93× |
| medium | evidence_assessment | 100 | 0.6412 | 0.6408 | 0.6687 | 0.6491 | 1.00× |
| medium | explainability_builder | 100 | 0.0388 | 0.0385 | 0.0394 | 0.0390 | 1.01× |
| medium | full_explainability_pipeline | 100 | 88.6075 | 50.6021 | 89.4806 | 51.3825 | 1.75× |
| large | summary_validation | 30 | 819.2099 | 487.2545 | 851.2087 | 556.9619 | 1.68× |
| large | evidence_consistency | 30 | 411.7870 | 75.8629 | 413.4836 | 76.6022 | 5.43× |
| large | evidence_assessment | 30 | 2.6125 | 2.5883 | 2.6548 | 2.6707 | 1.01× |
| large | explainability_builder | 30 | 0.1601 | 0.1612 | 0.1652 | 0.1627 | 0.99× |
| large | full_explainability_pipeline | 30 | 1234.2933 | 564.4575 | 1257.5958 | 571.9335 | 2.19× |

Note: Measurements were collected in separate baseline and optimized
benchmark runs. Small-workload tail latency showed variance.

## 7. Additional Verification

- Focused regression: 170 tests PASS, 7 deprecation warnings.
- New cache regression: 4 tests PASS.
- Output equivalence with original commit: PASS for tested cases.
- Nonempty diagnostic equivalence: 4 cases PASS.
- Concurrent request isolation: 24/24 matched serial results.
- Optimized benchmark stability: 3 independent runs PASS.
- Same-process Evidence Consistency P50:
  - Small: 0.4901 ms → 0.4751 ms (1.03×).
  - Medium: 28.9510 ms → 10.0183 ms (2.89×).
  - Large: 416.2129 ms → 76.0227 ms (5.47×).

## 8. Limitations

### BLOCKED

Six real-ASR consistency tests could not complete because the local
repository lacks:

- `tests/fixtures/persisted_asr_latest_job.json`
- `tests/fixtures/persisted_asr_job_96f3f050.json`

These failures were FileNotFoundError, not observed evidence mismatches.
Do not count these tests as PASS.

Numeric confidence calibration remains blocked by missing labeled data;
confidence scores must remain None.

### DEFERRED

- Automatic production Explainability Metadata persistence.
- Backend/database explainability integration.
- Full AI–Backend explainability E2E.

### UNVERIFIED

- Full Workspace request-to-render P50/P95.
- Browser, Backend API, database and UI rendering contributions.
- Actual GPU Whisper/LLM inference under production workload.
- Celery multi-process and production retry concurrency.
- Production throughput and resource usage.
- End-to-end artifact persistence latency.
- Representative real-world workload distribution.

## 9. Conclusion

Request-scoped text caching improves AI-local Explainability processing
on the measured medium and large synthetic workloads while preserving
the tested Evidence Diagnostics.

These results must not be interpreted as Workspace E2E latency
improvements or production GPU inference improvements.

Final acceptance remains subject to read-only code review, regression
coverage assessment, and confirmation of the documented limitations.

## 10. Verified Source-state Benchmark

The following comparison evaluates only
`evidence_consistency_issues()`.

The original implementation was loaded from Git commit `5c1d01c`.
The optimized implementation was loaded from the current working
tree. Neither Git checkout nor modification of production files
was required.

### Source attribution

- Original SHA-256: `0636fe618cfa7c8f08d0b9a780b31cc7af8dadb2b4d64ce60db1dd42d734532a`
- Optimized SHA-256: `03b6b212a4a9d658bc5876dbc8d5464a89afb147630081b64b268c365e2f53c1`
- Source-state output equivalence: PASS for measured workloads.
- Python: `3.11.16`
- Environment: `Apple M2`,
  8 logical CPUs,
  8589934592 bytes RAM.
- Dependency versions: {"pydantic": "2.13.5", "fastapi": "0.141.1"}.
- Timer: `perf_counter_ns`.
- Warm-up iterations: 5.
- Concurrency: 1.

### Evidence Consistency latency (milliseconds)

| Workload | Samples | Before P50 | After P50 | Before P95 | After P95 | P50 Speedup |
|---|---:|---:|---:|---:|---:|---:|
| small | 100 | 0.5036 | 0.3839 | 0.8943 | 0.7625 | 1.31× |
| medium | 100 | 28.8359 | 9.8926 | 29.6780 | 9.9697 | 2.91× |
| large | 30 | 414.1928 | 75.9834 | 465.6778 | 76.1898 | 5.45× |

### Retained benchmark artifacts

- `performance_artifacts/evidence_baseline_verified.json`
- `performance_artifacts/evidence_optimized_comparison.json`
- `performance_artifacts/optimized_verified.json`

The first two artifacts preserve separate source fingerprints for
original and optimized evidence consistency implementations.

The third artifact records full Explainability Pipeline measurements
for the optimized implementation only.

### Measurement interpretation

The same-process benchmark runs the original implementation before
the optimized implementation, so ordering and machine-state effects
may influence latency. It is not a randomized A/B experiment.

The individual stage measurements in Section 6 are independent
timings of potentially overlapping operations. They must NOT be
summed to estimate full-pipeline latency.

The original full-pipeline before/after table was collected before
source fingerprinting was introduced. Its statistics match the
historical JSON files available during review, but those old files
do not independently establish source-state provenance.

The supplementary cProfile figures, same-process historical
measurements, and historical test totals were observed in Terminal;
their complete raw execution logs have not been retained as
version-controlled artifacts.

Three independent optimized benchmark runs were previously observed,
but Small workload latency varied substantially. Those results do
not establish stable production latency.

The verified comparisons are synthetic AI-local measurements only.
They do not measure Whisper or LLM GPU inference, persistence I/O,
Backend API processing, Frontend rendering, or full Workspace E2E.
