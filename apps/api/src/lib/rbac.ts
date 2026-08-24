/**
 * FR-601 — role-based access control with data scopes, mirroring PRD §9.
 * Segregation of duties: System Admin holds no financial or investment approval,
 * and no role may both create and approve the same money movement (FR-405).
 */
export const ROLES = [
  'investor',
  'project_owner',
  'investment_analyst',
  'committee_member',
  'compliance',
  'finance_ops',
  'portfolio_ops',
  'system_admin',
  'auditor',
] as const;

export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  // identity & compliance
  'identity.read_any', 'identity.review_kyc', 'identity.suspend', 'identity.classify',
  // origination
  'application.create', 'application.read_own', 'application.read_any', 'application.screen',
  'dd.read', 'dd.work', 'dd.score', 'committee.read', 'committee.vote', 'committee.decide',
  // pools
  'pool.build', 'pool.publish', 'pool.pause', 'pool.cancel', 'pool.read_any', 'qa.moderate',
  // investing
  'order.create', 'order.read_own', 'order.read_any',
  // funds — maker vs checker
  'funds.read', 'funds.reconcile', 'funds.request', 'funds.approve',
  // portfolio & monitoring
  'report.submit', 'report.review', 'report.publish', 'monitor.read', 'pool.monitor', 'distribution.create',
  // support & admin
  'case.read_any', 'case.work', 'complaint.create', 'settings.propose', 'settings.approve',
  'admin.users', 'audit.read', 'reports.export', 'banner.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  investor: ['order.create', 'order.read_own', 'complaint.create'],

  project_owner: ['application.create', 'application.read_own', 'report.submit', 'complaint.create'],

  investment_analyst: [
    'application.read_any', 'application.screen', 'dd.read', 'dd.work', 'dd.score',
    'committee.read', 'pool.read_any', 'case.work',
  ],

  // Votes within quorum; never touches money (PRD §9).
  committee_member: ['committee.read', 'committee.vote', 'committee.decide', 'application.read_any',
                     'pool.read_any', 'dd.read'],

  compliance: [
    'identity.read_any', 'identity.review_kyc', 'identity.suspend', 'identity.classify',
    'application.read_any', 'pool.read_any', 'pool.pause', 'funds.read', 'case.read_any', 'case.work',
    'settings.propose', 'settings.approve', 'audit.read', 'reports.export', 'order.read_any',
    // Read-only oversight of origination, committee and monitoring — no action rights there.
    'dd.read', 'committee.read', 'monitor.read',
  ],

  // PRD §9 — Finance Ops both prepares and counter-approves money movements.
  // The safeguard is per transaction, not per role: `assertDualControl` blocks the
  // maker from approving their own request (FR-405, BR-012).
  finance_ops: ['funds.read', 'funds.reconcile', 'funds.request', 'funds.approve',
                'order.read_any', 'case.work', 'reports.export'],

  portfolio_ops: [
    'pool.read_any', 'monitor.read', 'pool.monitor', 'report.review', 'report.publish',
    'distribution.create', 'case.work', 'qa.moderate', 'pool.build', 'pool.publish',
  ],

  // Technical breadth, zero financial/investment approval.
  system_admin: ['admin.users', 'settings.propose', 'audit.read', 'banner.manage', 'pool.read_any'],

  auditor: [
    'audit.read', 'pool.read_any', 'application.read_any', 'funds.read', 'order.read_any',
    'case.read_any', 'dd.read', 'committee.read', 'monitor.read',
  ],
};

/** Roles that must clear MFA before any privileged action (FR-007). */
export const MFA_REQUIRED_ROLES: Role[] = [
  'compliance', 'finance_ops', 'portfolio_ops', 'system_admin', 'committee_member', 'investment_analyst',
];

export function permissionsFor(roles: string[]): Set<Permission> {
  const set = new Set<Permission>();
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role as Role] ?? []) set.add(permission);
  }
  return set;
}

export const hasPermission = (roles: string[], permission: Permission): boolean =>
  permissionsFor(roles).has(permission);

export const requiresMfa = (roles: string[]): boolean =>
  roles.some((role) => MFA_REQUIRED_ROLES.includes(role as Role));

/** Second-line approver on a money movement must differ from the maker (FR-405, BR-012). */
export function assertDualControl(makerId: string, checkerId: string): void {
  if (makerId === checkerId) {
    throw new Error('dual_control_violation');
  }
}
