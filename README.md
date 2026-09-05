# حِصّة | Hissa Pools

منصة تمويل جماعي لمشاريع تشغيلية محددة في سلطنة عُمان — تنفيذ كامل لـ **Pilot MVP**
وفق وثيقة المشروع ووثيقة متطلبات المنتج (PRD v1.0).

A crowdfunding platform for specific operational projects in the Sultanate of Oman.
This repository is a complete Pilot MVP implementation of the product document and PRD v1.0.

> **الوضع التنظيمي.** تعمل حِصّة من خلال مشغل تمويل جماعي مرخّص. لا تحتفظ المنصة بأموال
> المستثمرين في حسابها التشغيلي (BR-001, BR-002). هذا المستودع تنفيذ منتج وليس عرضًا
> استثماريًا أو رأيًا قانونيًا؛ تُعتمد القواعد النهائية والعقود والحدود من مستشار قانوني
> عُماني وهيئة الخدمات المالية أو المشغل المرخّص قبل أي إطلاق حقيقي.

---

## النسخة الحيّة · Live demo

**<https://alqaisi95.github.io/Hissa/>**

صفحة واحدة تحمل النظام كاملًا وتعمل داخل المتصفّح بلا خادم: المستند نفسه هو قاعدة
البيانات، وكل إجراء يعيد كتابته. تعمل دون اتصال وتُثبَّت على شاشة الهاتف. ادخل بأي حساب
من «ادخل بصفة جاهزة» في الصفحة الرئيسية — كلمة المرور `Hissa#2026` — فكل صفة ترى تطبيقًا
مختلفًا لأن الصلاحية على الحساب هي التي تقرّر.

A single self-contained page carrying the whole system, running in the browser with no
server: the document *is* the database, and every action rewrites it. It works offline and
installs to a phone's home screen. Sign in from the ready-made accounts on the landing
page — password `Hissa#2026`.

> لا شريك مرخّص خلفها ولا حساب ضمان ولا مزوّد تحقق هوية، ولا تتحرك فيها أموال حقيقية.
> الحسابات وكلماتها معروضة عمدًا لأنها لا تحرس شيئًا.

```bash
npm run demo:serve    # يخدمها محليًّا
npm run demo:test     # 16 مُشغِّل اختبار على متصفّح حقيقي
npm run demo:audit    # قياس الواجهة على 390 · 768 · 1440
npm run demo:site     # يبني نسخة site/ العامة المنشورة أعلاه
```

المصدر كلّه في [`demo/hissa-live.html`](demo/hissa-live.html). وما تحته في هذا الملف
يصف تنفيذ المكدّس الكامل تحت `apps/` — واجهة برمجية ومتصفّح منفصلان — وهو مسار آخر
للمنتج نفسه لا ما يعمل على الرابط أعلاه.

---

## Quick start

```bash
npm install
NODE_ENV=development npm run seed -w apps/api -- --fresh   # pilot dataset: 3 pools, full staff roster
npm run dev                             # API on :4000, web on :5173
```

| Persona | Email | Password |
|---|---|---|
| Investor (retail) | `investor1@example.om` | `HissaPilot#2026` |
| Investor (sophisticated) | `sophisticated@example.om` | `HissaPilot#2026` |
| Project owner | `owner.cafe@example.om` | `HissaPilot#2026` |
| Investment analyst | `analyst@hissa.om` | `HissaPilot#2026` |
| Committee member | `committee1@hissa.om` | `HissaPilot#2026` |
| Compliance | `compliance@hissa.om` | `HissaPilot#2026` |
| Finance ops (maker) | `finance.maker@hissa.om` | `HissaPilot#2026` |
| Finance ops (checker) | `finance.checker@hissa.om` | `HissaPilot#2026` |
| Portfolio ops | `portfolio@hissa.om` | `HissaPilot#2026` |
| System admin | `admin@hissa.om` | `HissaPilot#2026` |

Staff roles require MFA. In development the one-time code is echoed in the sign-in
response and shown under the code field — never in production (`config.exposeOtp`).

```bash
npm test          # 85 tests: AT-01..AT-12, engines, full journey
npm run typecheck # API and web
npm run build     # production build
```

---

## What is implemented

Every requirement identifier below is the one used in the PRD, and it appears in the
code as a comment next to the logic that satisfies it.

### Identity and suitability — FR-001…FR-008
Registration with OTP on email or phone, MFA for privileged roles, investor
classification with compliance sign-off, a suitability assessment that **restricts on a
misunderstood core risk regardless of total score**, eKYC/KYB with UBO and sanctions/PEP
screening, versioned consents storing a hash of the exact text shown, and periodic
re-verification that moves a lapsed account to `restricted`.

### Origination and due diligence — FR-101…FR-108
Draft-capable applications that survive across sessions, a classified document vault with
versions, checksums and malware scanning, bank/POS feeds with month-coverage tracking,
two-way information requests on an SLA clock, a 14-item due-diligence checklist where
waiving a mandatory item demands written justification, a **versioned weighted risk model**
whose score, inputs and model version are all retained, and a committee flow with a hashed
decision pack, configurable quorum and **conflict-forced recusal** (BR-016).

### Pools and disclosure — FR-201…FR-208
A disclosure builder whose mandatory sections are enforced by schema, **immutable hashed
versions** that are superseded rather than replaced, publication gates (owner contribution
received first, no banned guarantee wording, conservative ≤ base ≤ optimistic), the public
marketplace, a permissioned data room with logged downloads and denials, moderated Q&A, and
pause / extend / cancel with reasons and investor notification.

### Investment — FR-301…FR-308
An eligibility gate that evaluates KYC, suitability, consents, account status and the
investor limits, returning **what is available without disclosing the internal rule**;
a quote with fees, units and ownership share; acknowledgements bound to the exact
disclosure version; hand-off to the licensed partner's hosted checkout (no card data
touches Hissa); idempotent webhooks; and a **deterministic largest-remainder allocation**
whose result always ties exactly to the ceiling.

### Funds — FR-401…FR-408
Escrow references rather than an internal balance, daily reconciliation whose differences
become SLA'd cases and are never auto-closed, **all-or-nothing closing** that refunds every
confirmed commitment when the minimum is missed, milestone disbursements requiring met
conditions with evidence, refunds and distributions from evidenced realised cash — every
money movement under **dual control** where the maker can never approve their own request.

### Portfolio and monitoring — FR-501…FR-509
Report schedules with reminders, KPI actual-vs-forecast variance, covenants that raise
alerts and cases on breach, publication review that keeps drafts away from investors,
a portfolio showing nominal values only (**no implied market price**), voting weighted by
holdings at the record date, default/workout handling, and a final-settlement close that
refuses to run while any money movement is still in flight.

### Dashboards and analytics — PRD §14
An operations dashboard that leads with what needs attention — reconciliation
breaks, cases and reports against their SLAs, money awaiting a second approver —
then explains it with a cumulative commitment trend, the conversion funnel, pool
status and sector mix. Each pool carries its own dashboard: funding curve,
investor mix by classification, ticket-size bands, milestone progress, escrow
position, and actual-against-forecast for every reported KPI. Investors get the
same treatment on their own holdings, in nominal terms only.

Chart colour is computed, not chosen. The categorical slots and the teal ordinal
ramp were run through a palette validator — lightness band, chroma floor,
colour-vision separation, normal-vision floor and contrast against this product's
own light and dark chart surfaces, each mode validated on its own rather than
flipped. One slot sits under 3:1 on the light surface, which is legal only with a
second channel, so every chart ships direct labels and a table view and no chart
rests identity on colour alone. Status uses a reserved scale that never doubles as
a series colour and always carries a glyph and a word.

### Administration — FR-601…FR-610
RBAC with segregation of duties, work queues, an **append-only audit log** enforced by
database triggers, case management with internal notes that never surface externally,
complaints with references and SLAs, reproducible exports carrying their filters and
extraction time, **effective-dated settings** that cannot apply retroactively and need a
second approver, bilingual notification templates, incident banners, and PDPL data-subject
requests with a self-service export.

### Business rules BR-001…BR-020
All twenty are enforced in code rather than documented and hoped for. The full mapping is
in [`docs/TRACEABILITY.md`](docs/TRACEABILITY.md).

---

## Architecture

```
apps/api                     Modular monolith with explicit domain boundaries (PRD §16.1)
  src/domains/analytics/     event tracking, KPI definitions, dashboard aggregations
  src/domains/               identity · origination · pools · orders · funds
                             portfolio · cases · admin · analytics · public
  src/workflow/              pool state machine, application states, scheduler
  src/integrations/          partner · eKYC · e-sign · notifications  (swappable adapters)
  src/lib/                   money · rbac · settings · audit · documents · legal · crypto
  src/db/                    schema.sql · access layer · seed
apps/web                     React + Vite, Arabic RTL / English LTR
  src/components/charts.tsx  validated palettes, mark specs, table view per chart
  src/pages/{public,investor,owner,staff}
```

**Money.** Amounts are integer *baisa* (1 OMR = 1000) everywhere — no floats in financial
arithmetic (PRD §10.1). Percentages are basis points. Pro-rata allocation uses the
largest-remainder method so a split always sums back to the total.

**Time.** Stored UTC, presented in Asia/Muscat.

**State.** Every pool transition records a reason, an authorised actor, a timestamp and the
related inputs. A reverse move is a new event, never a deletion (PRD §5).

**Integration contract.** Every money call carries an idempotency key and a correlation id;
webhooks are signed and processed exactly once; a **timeout is not a failure** — the order
stays `pending` until the partner answers or reconciliation resolves it (§11.1, AT-09).

### Sandbox adapters

`integrations/` ships sandbox implementations with the production contract already in
place. Going live means replacing the adapter body, not the calling code:

| Adapter | Sandbox behaviour |
|---|---|
| `partner.ts` | Hosted-checkout stub, idempotent references, settlement via signed webhook |
| `ekyc.ts` | Deterministic outcomes from ID prefixes: `999…` sanctions, `888…` PEP, `777…` manual review |
| `esign.ts` | Signed artefact with evidence, stored with a checksum |
| `notifications.ts` | Queued delivery with channel fallback to in-app |
| `storage.ts` | Local object store mirroring the S3 contract |

---

## Testing

```
AT-01  commitment confirms, receipt bound to the disclosure hash, audited
AT-02  retail per-issuer cap blocks the excess and shows exactly what remains
AT-03  missed target refunds every commitment and disburses nothing
AT-04  material change supersedes the version, notifies, opens a case
AT-05  the maker cannot approve; approval without evidence is refused
AT-06  overdue report raises an alert, a case and an escalation
AT-07  403 without disclosing data, and the attempt is logged
AT-08  duplicate webhook applies once and records the replay
AT-09  partner timeout stays pending, never failed
AT-10  Arabic journey, bilingual errors, OMR three decimals
AT-11  complaint yields reference, SLA, owner and acknowledgement
AT-12  audit log and published disclosures are immutable
```

Plus unit coverage of the money, allocation, risk, suitability, state-machine and RBAC
engines, and an end-to-end journey from company registration through committee decision,
publication, oversubscribed funding, reconciliation, allocation, disbursement, reporting
and distribution.

---

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `NODE_ENV` | **`production`** | Unset means production. Say `development` on a laptop. |
| `PORT` | `4000` | API port |
| `HISSA_DB` | `apps/api/data/hissa.sqlite` | Database file (`:memory:` in tests) |
| `HISSA_STORAGE` | `apps/api/data/objects` | Object store root |
| `PARTNER_WEBHOOK_SECRET` | **none — required** | HMAC secret for partner webhooks. The API refuses to start without it outside development. |
| `PARTNER_BASE_URL` | sandbox | Licensed operator base URL |
| `SESSION_TTL_HOURS` | `12` | Session lifetime |
| `CORS_ORIGINS` | `http://localhost:5173` | Allowed origins |
| `ANALYTICS_SALT` | dev value | Pseudonymisation salt (§14.1) |
| `HISSA_DEV_OTP` | off | Set to `1` to echo OTP codes in API responses. Ignored in production. |
| `SEED_PASSWORD` | dev value | Password for seeded accounts. Required outside development; the seed refuses production entirely. |

Three of these fail *closed* on purpose. `NODE_ENV` defaults to production because an
unlabelled environment is more likely to be the real one than a laptop; the webhook
secret has no fallback because a settlement it verifies turns into holdings; and the OTP
echo hands the second factor to whoever already has the password, so it has to be asked
for by name.

The datastore is SQLite via Node's built-in `node:sqlite`, chosen so the pilot runs with
no external service. The access layer is a thin SQL wrapper; moving to PostgreSQL means
porting `schema.sql` and `db/index.ts`.

---

## Before real money moves

The PRD's Go-Live conditions (§13.3, §15.1) are product and legal gates, not code:

1. A signed agreement with a licensed operator, and the RACI matrix between the parties.
2. Omani legal counsel sign-off on the SPV structure, contracts and disclosure memorandum.
3. Investor limits re-validated with the FSA and the operator — the published values in
   `lib/settings.ts` are the PRD's working assumptions, effective-dated so they can be
   changed with an approval trail rather than a deployment.
4. A PDPL review covering controller/processor roles, hosting, cross-border transfer,
   retention and breach notification.
5. Penetration test with no open critical or high findings, and a successful restore drill.
6. Production adapters for the partner, eKYC/AML, escrow, e-sign and messaging.

Open decisions OD-01…OD-10 from PRD §17.1 remain open; where the code had to assume
something (cooling-off disabled, pro-rata allocation, the published fee schedule), the
assumption is an effective-dated setting rather than a constant.
