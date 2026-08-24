# مصفوفة التتبع | Traceability matrix

Maps every PRD identifier to the code that implements it and the test that proves it.
Paths are relative to the repository root.

## Business rules — BR-001…BR-020

| ID | Rule | Enforced in | Test |
|---|---|---|---|
| BR-001 | Funds raised and investments executed through a licensed operator | `integrations/partner.ts` — the only payment path; no internal money movement exists | journey |
| BR-002 | Client money segregated from Hissa's operating account | `funds/routes.ts` `/pools/:id/position` returns external references only; no balance column exists | AT-01 |
| BR-003 | Retail cap of OMR 3,000 per issuer | `orders/eligibility.ts` `usedPerIssuer` + `capsFor` | AT-02 |
| BR-004 | Retail cap of OMR 20,000 rolling 12 months | `orders/eligibility.ts` `usedRolling12m` | AT-02 |
| BR-005 | Angel cap of OMR 100,000 rolling 12 months | `orders/eligibility.ts` `capsFor` | domain |
| BR-006 | Sophisticated: no published amount cap | `orders/eligibility.ts` `capsFor` returns `null` | domain |
| BR-007 | Issuer under 12 months capped at OMR 100,000 | `orders/eligibility.ts` `issuerRaiseAllowed`, checked at submission and pool creation | journey |
| BR-008 | All-or-Nothing in the pilot | `funds/closing.ts` `closePool` | AT-03 |
| BR-009 | No investment before KYC, suitability and acknowledgement | `orders/eligibility.ts` blocks + `orders/routes.ts` acknowledgement check | AT-01, journey |
| BR-010 | Pilot pool size OMR 40k–100k | `pools/routes.ts` against `poolPolicy()` | journey |
| BR-011 | Owner contribution 20–30% | `pools/routes.ts` contribution band; flagged in `riskModel.ts` | journey, domain |
| BR-012 | Disbursement to supplier or documented milestone | `funds/routes.ts` requires `condition_met` with evidence | AT-05 |
| BR-013 | No guarantee of return or capital | `lib/settings.ts` `findBannedTerms`, applied to disclosures, answers and reports | journey |
| BR-014 | Material change creates a new disclosure and an approval action | `pools/routes.ts` publish: notifies investors, opens a case | AT-04 |
| BR-015 | Distributions only from realised, evidenced cash | `funds/routes.ts` requires `cash_evidence_doc_id` before approval | journey |
| BR-016 | A conflicted member recuses | `origination/routes.ts` vote: a declared conflict becomes `recused` | journey |
| BR-017 | Oversubscription follows a declared allocation rule | `orders/allocation.ts` | domain, journey |
| BR-018 | No secondary market in the MVP | No transfer endpoint exists; stated in disclosure, FAQ and acknowledgements | — |
| BR-019 | Every document and acknowledgement is versioned and dated | `disclosure_versions`, `consents`, `documents`; SQLite trigger blocks rewriting a published disclosure | AT-12 |
| BR-020 | Limits and fees are effective-dated | `lib/settings.ts` `proposeSetting` rejects retroactive dates; `approveSetting` needs a second user | domain |

## Functional requirements

| Range | Area | Implementation |
|---|---|---|
| FR-001…008 | Account, identity, suitability | `domains/identity/` (`routes.ts`, `suitability.ts`), `integrations/ekyc.ts` |
| FR-101…108 | Origination, due diligence, committee | `domains/origination/` (`routes.ts`, `riskModel.ts`) |
| FR-201…208 | Pool creation and publication | `domains/pools/routes.ts` |
| FR-301…308 | Investment and commitment | `domains/orders/` (`routes.ts`, `eligibility.ts`, `allocation.ts`) |
| FR-401…408 | Funds, disbursement, distributions | `domains/funds/` (`routes.ts`, `closing.ts`, `reconciliation.ts`) |
| FR-501…509 | Post-investment and portfolio | `domains/portfolio/routes.ts`, `workflow/scheduler.ts` |
| FR-601…610 | Administration, compliance, support | `domains/admin/routes.ts`, `domains/cases/routes.ts`, `lib/rbac.ts`, `lib/audit.ts` |

### Notable requirement-level decisions

- **FR-002** — a self-declared classification above retail is recorded but does not take
  effect until compliance approves it. Both the declaration and the approval are versioned.
- **FR-005** — the assessment restricts on any knockout answer regardless of total score:
  a misunderstood core risk is not something a high score can offset.
- **FR-106** — the risk model stores the score, every input and the model version, so a
  past committee decision can be reproduced exactly.
- **FR-202** — a published disclosure is immutable at the database level; a new version
  supersedes it and the two can be compared field by field (`/disclosures/diff`).
- **FR-301** — a block tells the investor the reason and the amount available, never the
  internal threshold that produced it.
- **FR-306** — allocation is largest-remainder pro-rata: deterministic, reproducible, and
  it always ties exactly to the ceiling. A share scaled below the minimum ticket is
  refunded rather than part-issued, and the freed amount is redistributed.
- **FR-405** — dual control is enforced per transaction, not by splitting the permission
  across roles. Finance Ops both prepares and approves, but never the same request.
- **FR-509** — final settlement refuses to close while any refund, distribution or
  disbursement is still in flight.

## Non-functional requirements

| ID | Requirement | Where |
|---|---|---|
| NFR-006 | TLS, encryption, secret management, session hardening | `config.ts` (env-only secrets), `app.ts` security headers, `middleware/auth.ts`, `lib/crypto.ts` (scrypt, HMAC, timing-safe compare) |
| NFR-007 | WCAG 2.1 AA on critical journeys | Semantic landmarks, labelled fields, `aria-*` on tabs/progress, visible focus rings, reduced-motion support |
| NFR-008 | Arabic RTL and English LTR without mixing or clipping | `lib/i18n.tsx` drives `lang`/`dir`; the stylesheet uses logical properties throughout |
| NFR-009 | 100% of sensitive actions record actor/time/before/after | `lib/audit.ts`; `audit_events` is append-only by trigger |
| NFR-010 | Data minimisation, masking, provable consent | `analytics/track.ts` pseudonymises and drops identifying keys; `consents` stores a content hash |
| NFR-011 | Limits, fees and templates configurable without deployment | `lib/settings.ts`, `/api/admin/settings` |
| NFR-012 | Logs, metrics, alerting on errors and pending transactions | `job_runs`, `/api/health`, `chasePendingPayments`, alert and case generation |

## Acceptance criteria — AT-01…AT-12

All twelve are implemented as executable tests in
`apps/api/src/__tests__/acceptance.test.ts`, each named for the criterion it proves.

## Deliberately not implemented (PRD §4.2)

Secondary market or transfer between investors, native mobile applications, an internal
wallet or custody, multi-instrument debt, donations or rewards, cross-border listing or
investment, and fully automated approval without human review. No endpoint, table or
screen exists for any of them.
