-- حِصّة | Hissa Pools — Relational schema (PRD §10 نموذج البيانات)
-- Conventions (PRD §10.1 معايير البيانات):
--   * UUID primary keys; never phone/CR as PK.
--   * Money stored as INTEGER baisa (1 OMR = 1000 baisa) — no floats in financial math.
--   * Timestamps stored as UTC ISO-8601 TEXT; presented in Asia/Muscat.
--   * Documents referenced by object-storage key + checksum.

PRAGMA foreign_keys = ON;

-- ═══════════════════════════ Identity ═══════════════════════════

CREATE TABLE IF NOT EXISTS users (
  id                TEXT PRIMARY KEY,
  email             TEXT UNIQUE,
  phone             TEXT UNIQUE,
  full_name         TEXT NOT NULL,
  password_hash     TEXT NOT NULL,
  password_salt     TEXT NOT NULL,
  locale            TEXT NOT NULL DEFAULT 'ar' CHECK (locale IN ('ar','en')),
  status            TEXT NOT NULL DEFAULT 'pending_verification'
                    CHECK (status IN ('pending_verification','active','restricted','suspended','closed')),
  email_verified_at TEXT,
  phone_verified_at TEXT,
  mfa_enabled       INTEGER NOT NULL DEFAULT 0,
  mfa_secret        TEXT,
  failed_logins     INTEGER NOT NULL DEFAULT 0,
  locked_until      TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,
  scope      TEXT,                          -- optional data scope (e.g. entity id)
  granted_by TEXT REFERENCES users(id),
  granted_at TEXT NOT NULL,
  PRIMARY KEY (user_id, role)
);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  mfa_passed   INTEGER NOT NULL DEFAULT 0,
  ip           TEXT,
  user_agent   TEXT,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  revoked_at   TEXT
);

-- FR-001: OTP verification of at least one contact channel.
CREATE TABLE IF NOT EXISTS otp_codes (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel     TEXT NOT NULL CHECK (channel IN ('email','sms')),
  purpose     TEXT NOT NULL CHECK (purpose IN ('verify_contact','mfa','password_reset','payment_change')),
  code_hash   TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  consumed_at TEXT,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

-- FR-002 / FR-005 / FR-008: classification, suitability, re-verification.
CREATE TABLE IF NOT EXISTS investor_profiles (
  id                     TEXT PRIMARY KEY,
  user_id                TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  classification         TEXT NOT NULL DEFAULT 'retail'
                         CHECK (classification IN ('retail','angel','sophisticated')),
  classification_evidence TEXT,
  classification_effective_from TEXT,
  suitability_score      INTEGER,
  suitability_result     TEXT CHECK (suitability_result IN ('pass','warn','restricted')),
  suitability_taken_at   TEXT,
  kyc_status             TEXT NOT NULL DEFAULT 'not_started'
                         CHECK (kyc_status IN ('not_started','pending','in_review','approved','rejected','expired')),
  kyc_reference          TEXT,
  kyc_approved_at        TEXT,
  kyc_expires_at         TEXT,
  risk_rating            TEXT CHECK (risk_rating IN ('low','medium','high')),
  pep_flag               INTEGER NOT NULL DEFAULT 0,
  sanctions_flag         INTEGER NOT NULL DEFAULT 0,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);

-- Historical, non-replacing versions of classification/eligibility (PRD §10).
CREATE TABLE IF NOT EXISTS investor_profile_versions (
  id             TEXT PRIMARY KEY,
  profile_id     TEXT NOT NULL REFERENCES investor_profiles(id) ON DELETE CASCADE,
  classification TEXT NOT NULL,
  kyc_status     TEXT NOT NULL,
  reason         TEXT NOT NULL,
  actor_id       TEXT REFERENCES users(id),
  created_at     TEXT NOT NULL
);

-- FR-006: versioned, dated consents.
CREATE TABLE IF NOT EXISTS consents (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_key TEXT NOT NULL,
  version      TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  accepted_at  TEXT NOT NULL,
  ip           TEXT
);

-- FR-004: legal entity, UBOs, authorised representatives (KYB).
CREATE TABLE IF NOT EXISTS legal_entities (
  id             TEXT PRIMARY KEY,
  legal_name     TEXT NOT NULL,
  cr_number      TEXT NOT NULL UNIQUE,
  activity       TEXT NOT NULL,
  incorporated_on TEXT NOT NULL,
  governorate    TEXT,
  kyb_status     TEXT NOT NULL DEFAULT 'not_started'
                 CHECK (kyb_status IN ('not_started','pending','in_review','approved','rejected')),
  kyb_reference  TEXT,
  created_by     TEXT NOT NULL REFERENCES users(id),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entity_people (
  id          TEXT PRIMARY KEY,
  entity_id   TEXT NOT NULL REFERENCES legal_entities(id) ON DELETE CASCADE,
  user_id     TEXT REFERENCES users(id),
  full_name   TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('ubo','director','authorised_rep')),
  ownership_bp INTEGER,                    -- basis points, for UBO
  id_reference TEXT,
  screened_at TEXT,
  screening_result TEXT CHECK (screening_result IN ('clear','hit','review')),
  created_at  TEXT NOT NULL
);

-- ═══════════════════════════ Documents ═══════════════════════════

CREATE TABLE IF NOT EXISTS documents (
  id            TEXT PRIMARY KEY,
  owner_type    TEXT NOT NULL,             -- application | entity | pool | report | disbursement | case | user
  owner_id      TEXT NOT NULL,
  category      TEXT NOT NULL,
  file_name     TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  storage_key   TEXT NOT NULL,
  checksum      TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  expires_on    TEXT,
  malware_scan  TEXT NOT NULL DEFAULT 'pending' CHECK (malware_scan IN ('pending','clean','infected')),
  visibility    TEXT NOT NULL DEFAULT 'internal'
                CHECK (visibility IN ('internal','investor_verified','public')),
  uploaded_by   TEXT NOT NULL REFERENCES users(id),
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents(owner_type, owner_id);

-- FR-206: data-room downloads are logged.
CREATE TABLE IF NOT EXISTS document_access_log (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id),
  action      TEXT NOT NULL CHECK (action IN ('view','download','denied')),
  ip          TEXT,
  created_at  TEXT NOT NULL
);

-- ═══════════════════════════ Origination ═══════════════════════════

CREATE TABLE IF NOT EXISTS project_applications (
  id                TEXT PRIMARY KEY,
  reference         TEXT NOT NULL UNIQUE,
  entity_id         TEXT NOT NULL REFERENCES legal_entities(id),
  owner_user_id     TEXT NOT NULL REFERENCES users(id),
  title_ar          TEXT NOT NULL,
  title_en          TEXT,
  sector            TEXT NOT NULL,
  governorate       TEXT,
  summary_ar        TEXT,
  requested_amount  INTEGER NOT NULL,       -- baisa
  owner_contribution INTEGER NOT NULL DEFAULT 0,
  tenor_months      INTEGER,
  use_of_funds      TEXT NOT NULL DEFAULT '[]',  -- JSON [{item, supplier, amount, evidence}]
  status            TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','submitted','due_diligence','committee','approved',
                                      'conditional','returned','rejected','withdrawn','published')),
  submitted_at      TEXT,
  decided_at        TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

-- FR-103: bank/POS data feed coverage per period.
CREATE TABLE IF NOT EXISTS financial_feeds (
  id             TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES project_applications(id) ON DELETE CASCADE,
  source         TEXT NOT NULL CHECK (source IN ('bank_api','pos_api','statement_upload')),
  period_start   TEXT NOT NULL,
  period_end     TEXT NOT NULL,
  gross_revenue  INTEGER NOT NULL,
  net_cash       INTEGER,
  quality        TEXT NOT NULL DEFAULT 'unverified' CHECK (quality IN ('unverified','verified','disputed')),
  document_id    TEXT REFERENCES documents(id),
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dd_cases (
  id             TEXT PRIMARY KEY,
  application_id TEXT NOT NULL UNIQUE REFERENCES project_applications(id) ON DELETE CASCADE,
  analyst_id     TEXT REFERENCES users(id),
  status         TEXT NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open','awaiting_applicant','ready_for_committee','decided','closed')),
  model_version  TEXT,
  risk_score     INTEGER,                   -- 0..100
  risk_grade     TEXT CHECK (risk_grade IN ('A','B','C','D','E')),
  score_inputs   TEXT NOT NULL DEFAULT '{}',
  sla_due_at     TEXT,
  opened_at      TEXT NOT NULL,
  closed_at      TEXT
);

CREATE TABLE IF NOT EXISTS dd_checklist_items (
  id           TEXT PRIMARY KEY,
  case_id      TEXT NOT NULL REFERENCES dd_cases(id) ON DELETE CASCADE,
  code         TEXT NOT NULL,
  label_ar     TEXT NOT NULL,
  mandatory    INTEGER NOT NULL DEFAULT 1,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','satisfied','waived','failed')),
  evidence_id  TEXT REFERENCES documents(id),
  note         TEXT,
  updated_by   TEXT REFERENCES users(id),
  updated_at   TEXT
);

-- FR-104: two-way information requests with SLA.
CREATE TABLE IF NOT EXISTS info_requests (
  id           TEXT PRIMARY KEY,
  case_id      TEXT NOT NULL REFERENCES dd_cases(id) ON DELETE CASCADE,
  requested_by TEXT NOT NULL REFERENCES users(id),
  body_ar      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','closed','overdue')),
  due_at       TEXT NOT NULL,
  answer_body  TEXT,
  answer_doc_id TEXT REFERENCES documents(id),
  answered_at  TEXT,
  closed_at    TEXT,
  created_at   TEXT NOT NULL
);

-- FR-107: committee pack, quorum, votes, conflict recusal (BR-016).
CREATE TABLE IF NOT EXISTS committee_sessions (
  id            TEXT PRIMARY KEY,
  case_id       TEXT NOT NULL REFERENCES dd_cases(id) ON DELETE CASCADE,
  quorum        INTEGER NOT NULL DEFAULT 3,
  pack_hash     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','decided','cancelled')),
  decision      TEXT CHECK (decision IN ('approved','conditional','rejected')),
  decision_reason TEXT,
  conditions    TEXT NOT NULL DEFAULT '[]',
  opened_at     TEXT NOT NULL,
  decided_at    TEXT
);

CREATE TABLE IF NOT EXISTS committee_votes (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES committee_sessions(id) ON DELETE CASCADE,
  member_id  TEXT NOT NULL REFERENCES users(id),
  vote       TEXT NOT NULL CHECK (vote IN ('approve','conditional','reject','recused')),
  rationale  TEXT NOT NULL,
  conflict_declared INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (session_id, member_id)
);

-- ═══════════════════════════ Pools ═══════════════════════════

CREATE TABLE IF NOT EXISTS pools (
  id               TEXT PRIMARY KEY,
  reference        TEXT NOT NULL UNIQUE,
  application_id   TEXT NOT NULL REFERENCES project_applications(id),
  entity_id        TEXT NOT NULL REFERENCES legal_entities(id),
  title_ar         TEXT NOT NULL,
  title_en         TEXT,
  sector           TEXT NOT NULL,
  governorate      TEXT,
  structure        TEXT NOT NULL DEFAULT 'spv_equity' CHECK (structure IN ('spv_equity','profit_share')),
  spv_name         TEXT,
  total_units      INTEGER NOT NULL,
  unit_price       INTEGER NOT NULL,        -- baisa
  target_amount    INTEGER NOT NULL,        -- baisa
  min_amount       INTEGER NOT NULL,        -- all-or-nothing floor (BR-008)
  max_amount       INTEGER,                 -- overfunding ceiling
  min_ticket       INTEGER NOT NULL DEFAULT 100000,   -- 100 OMR (Doc §1.2)
  max_ticket       INTEGER,
  owner_contribution INTEGER NOT NULL DEFAULT 0,
  owner_contribution_received_at TEXT,      -- BR "Owner First"
  tenor_months     INTEGER NOT NULL,
  allocation_rule  TEXT NOT NULL DEFAULT 'pro_rata' CHECK (allocation_rule IN ('pro_rata','first_confirmed')),
  status           TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','approved','funding','paused','funded','refunding',
                                     'disbursement','operating','default','workout','closed','cancelled','expired')),
  published_at     TEXT,
  closes_at        TEXT,
  funded_at        TEXT,
  closed_at        TEXT,
  escrow_account_ref TEXT,
  created_by       TEXT NOT NULL REFERENCES users(id),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

-- FR-202 / BR-019: disclosure versions are immutable and hashed.
CREATE TABLE IF NOT EXISTS disclosure_versions (
  id           TEXT PRIMARY KEY,
  pool_id      TEXT NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  version      INTEGER NOT NULL,
  sections     TEXT NOT NULL,              -- JSON: {summary, financials, rights, risks, fees, scenarios, evidence}
  content_hash TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','superseded')),
  change_reason TEXT,
  material_change INTEGER NOT NULL DEFAULT 0,
  created_by   TEXT NOT NULL REFERENCES users(id),
  approved_by  TEXT REFERENCES users(id),
  published_at TEXT,
  created_at   TEXT NOT NULL,
  UNIQUE (pool_id, version)
);

-- FR-207: moderated Q&A.
CREATE TABLE IF NOT EXISTS pool_questions (
  id          TEXT PRIMARY KEY,
  pool_id     TEXT NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  asked_by    TEXT NOT NULL REFERENCES users(id),
  body        TEXT NOT NULL,
  answer      TEXT,
  answered_by TEXT REFERENCES users(id),
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','answered','published','rejected')),
  created_at  TEXT NOT NULL,
  published_at TEXT
);

-- PRD §5 "قاعدة الحالة": every transition keeps reason, actor, timestamp, payload.
CREATE TABLE IF NOT EXISTS pool_state_events (
  id         TEXT PRIMARY KEY,
  pool_id    TEXT NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  from_state TEXT,
  to_state   TEXT NOT NULL,
  reason     TEXT NOT NULL,
  payload    TEXT NOT NULL DEFAULT '{}',
  actor_id   TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);

-- ═══════════════════════════ Orders / Investment ═══════════════════════════

CREATE TABLE IF NOT EXISTS investment_orders (
  id                 TEXT PRIMARY KEY,
  reference          TEXT NOT NULL UNIQUE,
  pool_id            TEXT NOT NULL REFERENCES pools(id),
  investor_id        TEXT NOT NULL REFERENCES users(id),
  amount             INTEGER NOT NULL,      -- baisa, gross committed
  platform_fee       INTEGER NOT NULL DEFAULT 0,
  units              INTEGER NOT NULL DEFAULT 0,
  allocated_amount   INTEGER,               -- after allocation rule (FR-306)
  refunded_amount    INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','confirmed','failed','cancelled','refunded','allocated')),
  disclosure_version_id TEXT NOT NULL REFERENCES disclosure_versions(id),
  acknowledgements   TEXT NOT NULL DEFAULT '[]',
  cooling_off_until  TEXT,                  -- FR-308 (only when legally adopted)
  confirmed_at       TEXT,
  cancelled_at       TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_pool ON investment_orders(pool_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_investor ON investment_orders(investor_id, status);

-- FR-401 / FR-304: external money references only — never an internal balance (BR-002).
CREATE TABLE IF NOT EXISTS payment_references (
  id             TEXT PRIMARY KEY,
  order_id       TEXT REFERENCES investment_orders(id) ON DELETE CASCADE,
  provider       TEXT NOT NULL,
  provider_ref   TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  direction      TEXT NOT NULL CHECK (direction IN ('collection','refund','disbursement','distribution')),
  amount         INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'initiated'
                 CHECK (status IN ('initiated','pending','settled','failed','reversed')),
  escrow_account_ref TEXT,
  raw_payload    TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

-- FR/AT-08: webhooks are logically processed exactly once.
CREATE TABLE IF NOT EXISTS webhook_events (
  id            TEXT PRIMARY KEY,
  provider      TEXT NOT NULL,
  event_id      TEXT NOT NULL,
  event_type    TEXT NOT NULL,
  signature_ok  INTEGER NOT NULL,
  payload       TEXT NOT NULL,
  processed_at  TEXT,
  duplicate_of  TEXT REFERENCES webhook_events(id),
  received_at   TEXT NOT NULL,
  UNIQUE (provider, event_id)
);

-- FR-402: daily reconciliation between commitments and partner/bank data.
CREATE TABLE IF NOT EXISTS reconciliation_runs (
  id           TEXT PRIMARY KEY,
  run_date     TEXT NOT NULL,
  scope        TEXT NOT NULL,
  matched      INTEGER NOT NULL DEFAULT 0,
  breaks       INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('running','completed','failed')),
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reconciliation_breaks (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL REFERENCES reconciliation_runs(id) ON DELETE CASCADE,
  order_id      TEXT REFERENCES investment_orders(id),
  provider_ref  TEXT,
  break_type    TEXT NOT NULL CHECK (break_type IN ('missing_internal','missing_external','amount_mismatch','status_mismatch')),
  internal_amount INTEGER,
  external_amount INTEGER,
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','resolved')),
  sla_due_at    TEXT NOT NULL,
  resolution    TEXT,
  resolved_by   TEXT REFERENCES users(id),
  resolved_at   TEXT,
  created_at    TEXT NOT NULL
);

-- ═══════════════════════════ Funds movements ═══════════════════════════
-- FR-405 / BR-012: dual control — maker cannot be checker.

CREATE TABLE IF NOT EXISTS disbursements (
  id             TEXT PRIMARY KEY,
  pool_id        TEXT NOT NULL REFERENCES pools(id),
  milestone_code TEXT NOT NULL,
  milestone_label TEXT NOT NULL,
  beneficiary    TEXT NOT NULL,
  beneficiary_iban TEXT,
  amount         INTEGER NOT NULL,
  condition_text TEXT NOT NULL,
  condition_met  INTEGER NOT NULL DEFAULT 0,
  evidence_doc_id TEXT REFERENCES documents(id),
  status         TEXT NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft','pending_approval','approved','executed','rejected','cancelled')),
  created_by     TEXT NOT NULL REFERENCES users(id),
  approved_by    TEXT REFERENCES users(id),
  payment_ref_id TEXT REFERENCES payment_references(id),
  created_at     TEXT NOT NULL,
  approved_at    TEXT,
  executed_at    TEXT
);

CREATE TABLE IF NOT EXISTS refunds (
  id             TEXT PRIMARY KEY,
  pool_id        TEXT NOT NULL REFERENCES pools(id),
  order_id       TEXT NOT NULL REFERENCES investment_orders(id),
  amount         INTEGER NOT NULL,
  reason         TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'requested'
                 CHECK (status IN ('requested','pending_approval','approved','settled','failed')),
  created_by     TEXT REFERENCES users(id),
  approved_by    TEXT REFERENCES users(id),
  payment_ref_id TEXT REFERENCES payment_references(id),
  created_at     TEXT NOT NULL,
  settled_at     TEXT
);

CREATE TABLE IF NOT EXISTS distributions (
  id            TEXT PRIMARY KEY,
  pool_id       TEXT NOT NULL REFERENCES pools(id),
  period_label  TEXT NOT NULL,
  gross_amount  INTEGER NOT NULL,
  fee_amount    INTEGER NOT NULL DEFAULT 0,
  net_amount    INTEGER NOT NULL,
  cash_evidence_doc_id TEXT REFERENCES documents(id),   -- BR-015: realised cash only
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','pending_approval','approved','paid','cancelled')),
  created_by    TEXT NOT NULL REFERENCES users(id),
  approved_by   TEXT REFERENCES users(id),
  created_at    TEXT NOT NULL,
  approved_at   TEXT,
  paid_at       TEXT
);

CREATE TABLE IF NOT EXISTS distribution_lines (
  id              TEXT PRIMARY KEY,
  distribution_id TEXT NOT NULL REFERENCES distributions(id) ON DELETE CASCADE,
  investor_id     TEXT NOT NULL REFERENCES users(id),
  units           INTEGER NOT NULL,
  gross_amount    INTEGER NOT NULL,
  fee_amount      INTEGER NOT NULL DEFAULT 0,
  net_amount      INTEGER NOT NULL,
  payment_ref_id  TEXT REFERENCES payment_references(id),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed'))
);

-- ═══════════════════════════ Portfolio / monitoring ═══════════════════════════

CREATE TABLE IF NOT EXISTS holdings (
  id           TEXT PRIMARY KEY,
  pool_id      TEXT NOT NULL REFERENCES pools(id),
  investor_id  TEXT NOT NULL REFERENCES users(id),
  units        INTEGER NOT NULL,
  invested_amount INTEGER NOT NULL,         -- nominal, no market value (FR-505)
  distributed_amount INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE (pool_id, investor_id)
);

CREATE TABLE IF NOT EXISTS covenants (
  id          TEXT PRIMARY KEY,
  pool_id     TEXT NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,
  label_ar    TEXT NOT NULL,
  metric      TEXT NOT NULL,
  operator    TEXT NOT NULL CHECK (operator IN ('gte','lte')),
  threshold   INTEGER NOT NULL,             -- integer; ratios in basis points
  breach_action TEXT NOT NULL DEFAULT 'alert',
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_reports (
  id            TEXT PRIMARY KEY,
  pool_id       TEXT NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  period_label  TEXT NOT NULL,
  period_start  TEXT NOT NULL,
  period_end    TEXT NOT NULL,
  due_at        TEXT NOT NULL,
  kpis          TEXT NOT NULL DEFAULT '{}', -- JSON {metric: {actual, forecast}}
  narrative     TEXT,
  variance_note TEXT,
  evidence_doc_id TEXT REFERENCES documents(id),
  status        TEXT NOT NULL DEFAULT 'scheduled'
                CHECK (status IN ('scheduled','draft','submitted','approved','published','late')),
  submitted_by  TEXT REFERENCES users(id),
  approved_by   TEXT REFERENCES users(id),
  published_at  TEXT,
  created_at    TEXT NOT NULL,
  UNIQUE (pool_id, period_label)
);

CREATE TABLE IF NOT EXISTS alerts (
  id          TEXT PRIMARY KEY,
  pool_id     TEXT REFERENCES pools(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  severity    TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
  message_ar  TEXT NOT NULL,
  context     TEXT NOT NULL DEFAULT '{}',
  case_id     TEXT,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
  created_at  TEXT NOT NULL,
  resolved_at TEXT
);

-- FR-507: corporate actions / voting.
CREATE TABLE IF NOT EXISTS votes (
  id          TEXT PRIMARY KEY,
  pool_id     TEXT NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  title_ar    TEXT NOT NULL,
  description TEXT NOT NULL,
  opens_at    TEXT NOT NULL,
  closes_at   TEXT NOT NULL,
  record_date TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','cancelled')),
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vote_ballots (
  id          TEXT PRIMARY KEY,
  vote_id     TEXT NOT NULL REFERENCES votes(id) ON DELETE CASCADE,
  investor_id TEXT NOT NULL REFERENCES users(id),
  choice      TEXT NOT NULL CHECK (choice IN ('for','against','abstain')),
  weight      INTEGER NOT NULL,             -- units at record date
  created_at  TEXT NOT NULL,
  UNIQUE (vote_id, investor_id)
);

-- ═══════════════════════════ Cases, complaints, admin ═══════════════════════════

CREATE TABLE IF NOT EXISTS cases (
  id           TEXT PRIMARY KEY,
  reference    TEXT NOT NULL UNIQUE,
  type         TEXT NOT NULL CHECK (type IN ('complaint','kyc_review','recon_break','report_late',
                                             'default','workout','dsar','material_change','incident')),
  subject      TEXT NOT NULL,
  body         TEXT,
  severity     TEXT NOT NULL DEFAULT 'normal' CHECK (severity IN ('low','normal','high','critical')),
  status       TEXT NOT NULL DEFAULT 'open'
               CHECK (status IN ('open','in_progress','awaiting_customer','escalated','resolved','closed')),
  raised_by    TEXT REFERENCES users(id),
  assignee_id  TEXT REFERENCES users(id),
  related_type TEXT,
  related_id   TEXT,
  sla_due_at   TEXT NOT NULL,
  resolution   TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  closed_at    TEXT
);

CREATE TABLE IF NOT EXISTS case_notes (
  id         TEXT PRIMARY KEY,
  case_id    TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  author_id  TEXT NOT NULL REFERENCES users(id),
  body       TEXT NOT NULL,
  internal   INTEGER NOT NULL DEFAULT 1,    -- FR-604: internal notes never surface externally
  created_at TEXT NOT NULL
);

-- FR-607 / BR-020: effective-dated settings, approved, never retroactive.
CREATE TABLE IF NOT EXISTS settings (
  id             TEXT PRIMARY KEY,
  key            TEXT NOT NULL,
  value          TEXT NOT NULL,             -- JSON
  effective_from TEXT NOT NULL,
  effective_to   TEXT,
  status         TEXT NOT NULL DEFAULT 'pending_approval'
                 CHECK (status IN ('pending_approval','active','superseded','rejected')),
  created_by     TEXT NOT NULL REFERENCES users(id),
  approved_by    TEXT REFERENCES users(id),
  note           TEXT,
  created_at     TEXT NOT NULL,
  approved_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_settings_key ON settings(key, status, effective_from);

-- FR-608: bilingual notification templates.
CREATE TABLE IF NOT EXISTS notification_templates (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  channel     TEXT NOT NULL CHECK (channel IN ('email','sms','inapp')),
  subject_ar  TEXT, subject_en TEXT,
  body_ar     TEXT NOT NULL, body_en TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved')),
  approved_by TEXT REFERENCES users(id),
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
  template_code TEXT NOT NULL,
  channel     TEXT NOT NULL,
  locale      TEXT NOT NULL,
  subject     TEXT,
  body        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','read')),
  fallback_of TEXT,
  created_at  TEXT NOT NULL,
  sent_at     TEXT
);

-- FR-609: incident / maintenance banner.
CREATE TABLE IF NOT EXISTS banners (
  id         TEXT PRIMARY KEY,
  message_ar TEXT NOT NULL,
  message_en TEXT NOT NULL,
  severity   TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
  audience   TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('all','investors','owners','staff')),
  starts_at  TEXT NOT NULL,
  ends_at    TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

-- FR-603 / NFR-009: append-only audit store.
CREATE TABLE IF NOT EXISTS audit_events (
  id          TEXT PRIMARY KEY,
  actor_id    TEXT,
  actor_role  TEXT,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  before_json TEXT,
  after_json  TEXT,
  reason      TEXT,
  ip          TEXT,
  correlation_id TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_events(created_at);

-- Functional immutability of the audit log (FR-603).
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;

-- Disclosure versions cannot be replaced once published (FR-202 / BR-019).
CREATE TRIGGER IF NOT EXISTS disclosure_no_edit_published BEFORE UPDATE ON disclosure_versions
WHEN OLD.status = 'published' AND NEW.status = 'published' AND OLD.content_hash <> NEW.content_hash
BEGIN SELECT RAISE(ABORT, 'published disclosure is immutable'); END;

-- §14: product analytics events (pseudonymous, no PII — §14.1).
CREATE TABLE IF NOT EXISTS analytics_events (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  pseudo_id   TEXT NOT NULL,
  pool_id     TEXT,
  properties  TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analytics_name ON analytics_events(name, created_at);

-- Scheduler bookkeeping (workflow engine).
CREATE TABLE IF NOT EXISTS job_runs (
  id          TEXT PRIMARY KEY,
  job_name    TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('running','ok','failed')),
  summary     TEXT,
  started_at  TEXT NOT NULL,
  finished_at TEXT
);
