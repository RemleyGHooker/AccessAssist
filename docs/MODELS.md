# Phase 4 system models

These models describe the **implemented local 0.4.0 source**, not a claim that Cloud Run already runs it. Groq is optional and has not been exercised with a real credential. The model source below and the rendered SVG/PDF artifacts describe the same components and flow.

## Model 1 — request workflow and states

Changed from Phase 3: the two-rule HTML-only step is replaced by bounded workers with format-specific parsers, deterministic checks and optional remediation. Parsing can produce a 422 even after a file passes signature checks. Resource limits and provider failures produce 503; all completion paths release upload memory.

Artifact: `models/workflow.svg` / `models/workflow.pdf`.

```mermaid
flowchart TD
    A([Received: POST /system/analyze]) --> B[Validate size, file/settings, MIME, signature]
    B -->|valid| C[Analyzing: bounded worker]
    B -->|invalid| E[400 / 413 / 415 / 422]
    C --> D[Parse HTML, PDF or DOCX; detect and map findings]
    D -->|unreadable| E
    C -->|capacity / timeout / worker failure| F[503 PROCESSING_UNAVAILABLE]
    D -->|success; worker terminated| G{Remediation mode}
    G -->|deterministic| H[Assemble scoped report]
    G -->|groq| I[Request generic rule guidance; validate complete JSON]
    I -->|valid| H
    I -->|missing key / invalid / timeout / rate limit| F
    E --> J[Clear upload buffer]
    F --> J
    H --> J
    J --> K([Respond: JSON; log metadata])
```

## Model 2 — component architecture and data flow

Changed from the Phase 2 sketch/Phase 3 model: a web upload page is the implemented client; parser/check modules and a Groq adapter now exist. No browser extension, standalone image/PPTX input or file-modification component is drawn as delivered. The tester and its in-memory state are shown because they are actual parts of this application.

Artifact: `models/architecture.svg` / `models/architecture.pdf`.

```mermaid
flowchart TD
    U[Upload page or API client] -->|multipart file + level| A[app.js: routing, version, request logs]
    A --> S[system.js: intake and common endpoints]
    A --> T[tester.js: sessions and reports in memory]
    A --> L[stdout: metadata only]
    S --> N[analyzer.js: capacity, worker deadline, report]
    S --> M[System test sessions in memory]
    N --> W[analysis-worker.js]
    W --> H[checks/html.js: jsdom]
    W --> P[checks/pdf.js: pdf-lib]
    W --> D[checks/docx.js: ZIP + XML]
    N --> R[remediation.js: deterministic instructions / optional AI]
    R -.->|generic rule templates; when configured| G[Groq API]
    T --> C[cases.js + fixtures.js]
    C --> V[contract.js + openapi.yaml: response validation]
    C -->|HTTP| X[Configured target system]
```

## Consistency check

| Element | Implementation evidence |
| --- | --- |
| Four intake checkpoints and all upload cleanup paths | `src/system.js`, T-04/T-06–T-11/T-24/T-25, O-03/O-04 |
| Per-format parser/check dispatch and worker teardown | `src/analysis-worker.js`, `src/analyzer.js`, T-18–T-30 |
| Fixed criteria and format-specific locations | `src/checks/*.js`, H-01–H-07/P-01–P-04/D-01–D-04 |
| Optional provider, strict response checks and failure path | `src/remediation.js`, G-01–G-06, T-16 |
| Common JSON schema conformance | `src/contract.js`, O-01/O-05 and all contract requests |
| Stateless documents / in-memory test state | `src/system.js`, `src/tester.js`, O-03/O-04; restart limitation disclosed |
| Web client reports, page locations and download | `public/index.html`, `public/app.js`, U-01/U-02 |

This is a source/test-based consistency check. An independent teammate walkthrough is still pending and must not be claimed as completed.
