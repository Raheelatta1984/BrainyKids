# Security review — 16 October 2026

- **Main deliverable:** [Security implementation review (PDF)](security-review-2026-10-16.pdf)
- [Readable source / implementation register](security-review-2026-10-16.md)
- [User-supplied five-check guidance](reference/vibe-coding-security-prompts.pdf) — Mayank Shah, v1.1; preserved with attribution.
- [All-dependency audit snapshot](npm-audit-2026-10-16.json) and [production-only snapshot](npm-audit-production-2026-10-16.json).
- [Local evidence probes](review-probes.ts).

This is an assessment of commit `9452412918ac7979458fbc26f2f4521a47791598`, **not a remediation release or security certification**. All 24 implementation actions remain open. The 12 P0 items are SEC-01–08, SEC-11, SEC-14, SEC-16 and SEC-24. Operational controls not visible in source remain unverified.

## Reproduce evidence

```sh
npm ci --ignore-scripts
npx tsx docs/security/review-probes.ts
npm run lint
npm run typecheck
npm run selftest
npm run levels-selftest
npm run quiz-selftest
npm run signup-selftest
npm run build
npm audit --json
npm audit --omit=dev --json
```

**Warning:** the dated probes assert unsafe baseline behaviour using fixtures and in-memory mocks. Their success means a finding was reproduced, not that the app is secure. Replace them with negative/invariant regression tests when fixing the findings; do not require these evidence assertions as CI security gates. They make no production network requests and write no accounts to storage. The audit commands consult the current registry and may differ from the saved snapshots; a nonzero audit exit denotes findings.

## Regenerate the PDF

Python tooling is isolated from the Next.js application and is not required at runtime:

```sh
python3 -m venv /tmp/brainykids-report-venv
/tmp/brainykids-report-venv/bin/pip install -r docs/security/requirements-report.txt
/tmp/brainykids-report-venv/bin/python docs/security/render_report.py
```

The PDF renderer consumes only the Markdown in this directory. Keep the dated baseline review unchanged as historical evidence; track fixes by SEC ID in a new remediation record. Do not add real credentials, live diagnostic exports or children's personal data to the repository.
