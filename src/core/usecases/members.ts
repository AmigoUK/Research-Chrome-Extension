/**
 * Project membership: who is on a project and in what role.
 *
 * `Project.members` is the authoritative record of roles; the `users` store
 * holds identity (name, email). `User.rolesPerProject` is kept in step here, in
 * the one place membership changes, so the two can never drift.
 */
import type { RepositorySet } from '../ports/repositories';
import type { Id, IsoDateTime, Project, ProjectRole, User } from '../model/types';
import { keepsAnOwner, roleOf } from '../model/roles';

/** A member joined with their identity — what the Team view lists. */
export interface MemberView {
  userId: Id;
  name: string;
  email?: string;
  role: ProjectRole;
  pending: boolean;
  /** Initials for the avatar, derived from the name. */
  initials: string;
}

export function initialsOf(name: string): string {
  const parts = name
    .replace(/@.*/, '')
    .split(/[\s._-]+/)
    .filter(Boolean);
  // One name part gives one initial too few, so take two letters from it.
  const letters =
    parts.length > 1 ? parts.slice(0, 2).map((p) => p[0] ?? '') : [(parts[0] ?? name).slice(0, 2)];
  return (letters.join('') || name.slice(0, 2)).toUpperCase();
}

/** Display name for an invited address, e.g. `j.park@lab.edu` → `j.park`. */
function nameFromEmail(email: string): string {
  return email.split('@')[0] || email;
}

async function requireProject(repos: RepositorySet, projectId: Id): Promise<Project> {
  const project = await repos.projects.get(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);
  return project;
}

async function saveProject(
  repos: RepositorySet,
  project: Project,
  now: IsoDateTime,
): Promise<void> {
  await repos.projects.put({ ...project, updatedAt: now });
}

export async function listMembers(repos: RepositorySet, projectId: Id): Promise<MemberView[]> {
  const project = await requireProject(repos, projectId);
  const users = await repos.users.list();
  return project.members.map((member) => {
    const user = users.find((u) => u.id === member.userId);
    const name = user?.name ?? member.userId;
    return {
      userId: member.userId,
      name,
      ...(user?.email ? { email: user.email } : {}),
      role: member.role,
      pending: member.pending === true,
      initials: initialsOf(name),
    };
  });
}

/**
 * Invite an email address to the project. Without a backend there is nothing to
 * send, so the invitation is a local record: a user row plus a pending member.
 * It becomes real when a snapshot carrying it reaches the other person.
 */
export async function inviteMember(
  repos: RepositorySet,
  args: { projectId: Id; email: string; role: ProjectRole; now: IsoDateTime; userId?: Id },
): Promise<MemberView> {
  const email = args.email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`Not an email address: ${email}`);
  const project = await requireProject(repos, args.projectId);

  const users = await repos.users.list();
  const existing = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (existing && roleOf(project.members, existing.id)) {
    throw new Error(`${email} is already a member`);
  }

  const user: User = existing ?? {
    id: args.userId ?? email,
    name: nameFromEmail(email),
    email,
    rolesPerProject: {},
  };
  await repos.users.put({
    ...user,
    rolesPerProject: { ...user.rolesPerProject, [args.projectId]: args.role },
  });
  await saveProject(
    repos,
    {
      ...project,
      members: [...project.members, { userId: user.id, role: args.role, pending: true }],
    },
    args.now,
  );

  return {
    userId: user.id,
    name: user.name,
    email,
    role: args.role,
    pending: true,
    initials: initialsOf(user.name),
  };
}

export async function setMemberRole(
  repos: RepositorySet,
  args: { projectId: Id; userId: Id; role: ProjectRole; now: IsoDateTime },
): Promise<void> {
  const project = await requireProject(repos, args.projectId);
  if (!roleOf(project.members, args.userId)) {
    throw new Error(`Not a member of this project: ${args.userId}`);
  }
  if (!keepsAnOwner(project.members, args.userId, args.role)) {
    throw new Error('A project must keep at least one owner');
  }

  await saveProject(
    repos,
    {
      ...project,
      members: project.members.map((m) =>
        m.userId === args.userId ? { ...m, role: args.role } : m,
      ),
    },
    args.now,
  );

  const user = await repos.users.get(args.userId);
  if (user) {
    await repos.users.put({
      ...user,
      rolesPerProject: { ...user.rolesPerProject, [args.projectId]: args.role },
    });
  }
}

export async function removeMember(
  repos: RepositorySet,
  args: { projectId: Id; userId: Id; now: IsoDateTime },
): Promise<void> {
  const project = await requireProject(repos, args.projectId);
  if (!keepsAnOwner(project.members, args.userId)) {
    throw new Error('A project must keep at least one owner');
  }

  await saveProject(
    repos,
    { ...project, members: project.members.filter((m) => m.userId !== args.userId) },
    args.now,
  );

  const user = await repos.users.get(args.userId);
  if (user) {
    const rolesPerProject = { ...user.rolesPerProject };
    delete rolesPerProject[args.projectId];
    await repos.users.put({ ...user, rolesPerProject });
  }
}
