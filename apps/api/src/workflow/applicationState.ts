/** PRD §5 — application/origination states feeding the pool lifecycle. */
export type ApplicationState =
  | 'draft' | 'submitted' | 'due_diligence' | 'committee'
  | 'approved' | 'conditional' | 'returned' | 'rejected' | 'withdrawn' | 'published';

export const APPLICATION_TRANSITIONS: Record<ApplicationState, ApplicationState[]> = {
  draft:         ['submitted', 'withdrawn'],
  submitted:     ['due_diligence', 'returned', 'rejected'],
  due_diligence: ['committee', 'returned', 'rejected'],
  committee:     ['approved', 'conditional', 'rejected'],
  approved:      ['published', 'withdrawn'],
  conditional:   ['approved', 'rejected', 'withdrawn'],
  returned:      ['submitted', 'withdrawn'],
  rejected:      [],
  withdrawn:     [],
  published:     [],
};

export const canApplicationTransition = (from: ApplicationState, to: ApplicationState): boolean =>
  APPLICATION_TRANSITIONS[from]?.includes(to) ?? false;
