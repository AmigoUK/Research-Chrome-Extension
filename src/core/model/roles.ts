/**
 * Project roles and what each one may do (design: `collaboration-sync.html`,
 * roadmap Phase 5). Pure data + pure predicates, so both the UI matrix and any
 * future enforcement read from one table.
 *
 * **Advisory, not enforced.** In local-only and file-based modes every client
 * holds a full copy of the data in its own IndexedDB, so a role cannot be
 * enforced — it documents intent and drives the UI. Only a self-hosted backend
 * (not built) could enforce it. The Team view states this plainly; do not write
 * code that pretends otherwise.
 */
import type { ProjectMember, ProjectRole } from './types';

export const CAPABILITIES = [
  'readExport',
  'annotate',
  'editStatus',
  'manageReferences',
  'manageMembers',
  'deleteProject',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const CAPABILITY_LABELS: Record<Capability, string> = {
  readExport: 'Read & export',
  annotate: 'Annotate',
  editStatus: 'Edit status',
  manageReferences: 'Manage references',
  manageMembers: 'Manage members',
  deleteProject: 'Delete project',
};

export const ROLES: readonly ProjectRole[] = ['owner', 'editor', 'viewer'];

export const ROLE_LABELS: Record<ProjectRole, string> = {
  owner: 'Owner',
  editor: 'Editor',
  viewer: 'Viewer',
};

export const ROLE_SUMMARIES: Record<ProjectRole, string> = {
  owner: 'Full access',
  editor: 'Edit sources, notes & status',
  viewer: 'Read & export',
};

/** The capability matrix from the design mock, as data. */
const ROLE_CAPABILITIES: Record<ProjectRole, readonly Capability[]> = {
  owner: CAPABILITIES,
  editor: ['readExport', 'annotate', 'editStatus', 'manageReferences'],
  viewer: ['readExport'],
};

export function can(role: ProjectRole | undefined, capability: Capability): boolean {
  return role ? ROLE_CAPABILITIES[role].includes(capability) : false;
}

/** The role a user holds on a project, or undefined when they are not a member. */
export function roleOf(members: readonly ProjectMember[], userId: string): ProjectRole | undefined {
  return members.find((m) => m.userId === userId)?.role;
}

/** Owners who have accepted — the set that must never become empty. */
export function activeOwners(members: readonly ProjectMember[]): ProjectMember[] {
  return members.filter((m) => m.role === 'owner' && !m.pending);
}

/**
 * Whether `members` would still have an owner after `userId` is removed or
 * demoted. A project without an owner can never be administered again.
 */
export function keepsAnOwner(
  members: readonly ProjectMember[],
  userId: string,
  nextRole?: ProjectRole,
): boolean {
  const remaining = activeOwners(members).filter((m) => m.userId !== userId);
  return remaining.length > 0 || nextRole === 'owner';
}
