import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { openContextNotesDB } from '../../src/adapters/idb/db';
import { createRepositories } from '../../src/adapters/idb/repositories';
import {
  listMembers,
  inviteMember,
  setMemberRole,
  removeMember,
  initialsOf,
} from '../../src/core/usecases/members';
import type { RepositorySet } from '../../src/core/ports/repositories';
import type { Project } from '../../src/core/model/types';

const NOW = '2026-07-24T00:00:00.000Z';
const LATER = '2026-07-24T10:00:00.000Z';

let repos: RepositorySet;
let counter = 0;

async function seed(): Promise<Project> {
  const project: Project = {
    id: 'p1',
    name: 'Urban Heat',
    sections: ['Literature'],
    members: [{ userId: 'me', role: 'owner' }],
    createdAt: NOW,
    updatedAt: NOW,
  };
  await repos.projects.put(project);
  await repos.users.put({ id: 'me', name: 'Tomasz Lewandowski', rolesPerProject: { p1: 'owner' } });
  return project;
}

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  repos = createRepositories(await openContextNotesDB(`members-${counter++}`));
  await seed();
});

describe('initialsOf', () => {
  it('takes the first letters of the first two name parts', () => {
    expect(initialsOf('Tomasz Lewandowski')).toBe('TL');
    expect(initialsOf('j.park@lab.edu')).toBe('JP');
    expect(initialsOf('Defra')).toBe('DE');
  });
});

describe('listMembers', () => {
  it('joins project members with their stored identity', async () => {
    const members = await listMembers(repos, 'p1');
    expect(members).toEqual([
      {
        userId: 'me',
        name: 'Tomasz Lewandowski',
        role: 'owner',
        pending: false,
        initials: 'TL',
      },
    ]);
  });

  it('falls back to the user id when no identity is stored', async () => {
    const project = (await repos.projects.get('p1'))!;
    await repos.projects.put({
      ...project,
      members: [...project.members, { userId: 'ghost', role: 'viewer' }],
    });
    const members = await listMembers(repos, 'p1');
    expect(members[1]?.name).toBe('ghost');
  });
});

describe('inviteMember', () => {
  it('records a pending member and a user row carrying the role', async () => {
    const invited = await inviteMember(repos, {
      projectId: 'p1',
      email: 'j.park@lab.edu',
      role: 'editor',
      now: LATER,
    });
    expect(invited).toMatchObject({ email: 'j.park@lab.edu', role: 'editor', pending: true });

    const members = await listMembers(repos, 'p1');
    expect(members).toHaveLength(2);
    expect(members[1]).toMatchObject({ name: 'j.park', role: 'editor', pending: true });

    const user = await repos.users.get(invited.userId);
    expect(user?.rolesPerProject['p1']).toBe('editor');
  });

  it('stamps the project as updated', async () => {
    await inviteMember(repos, {
      projectId: 'p1',
      email: 'j.park@lab.edu',
      role: 'viewer',
      now: LATER,
    });
    expect((await repos.projects.get('p1'))?.updatedAt).toBe(LATER);
  });

  it('rejects a malformed address', async () => {
    await expect(
      inviteMember(repos, { projectId: 'p1', email: 'not-an-email', role: 'viewer', now: LATER }),
    ).rejects.toThrow(/Not an email address/);
  });

  it('rejects inviting someone who is already a member', async () => {
    await repos.users.put({ id: 'me', name: 'Me', email: 'me@lab.edu', rolesPerProject: {} });
    await expect(
      inviteMember(repos, { projectId: 'p1', email: 'me@lab.edu', role: 'viewer', now: LATER }),
    ).rejects.toThrow(/already a member/);
  });
});

describe('setMemberRole', () => {
  it('updates the project member and the user mirror together', async () => {
    const invited = await inviteMember(repos, {
      projectId: 'p1',
      email: 'j.park@lab.edu',
      role: 'viewer',
      now: LATER,
    });
    await setMemberRole(repos, {
      projectId: 'p1',
      userId: invited.userId,
      role: 'editor',
      now: LATER,
    });

    const members = await listMembers(repos, 'p1');
    expect(members.find((m) => m.userId === invited.userId)?.role).toBe('editor');
    expect((await repos.users.get(invited.userId))?.rolesPerProject['p1']).toBe('editor');
  });

  it('refuses to demote the last owner', async () => {
    await expect(
      setMemberRole(repos, { projectId: 'p1', userId: 'me', role: 'viewer', now: LATER }),
    ).rejects.toThrow(/at least one owner/);
    expect((await listMembers(repos, 'p1'))[0]?.role).toBe('owner');
  });

  it('refuses to set a role for a non-member', async () => {
    await expect(
      setMemberRole(repos, { projectId: 'p1', userId: 'stranger', role: 'editor', now: LATER }),
    ).rejects.toThrow(/Not a member/);
  });
});

describe('removeMember', () => {
  it('drops the member and clears their project role', async () => {
    const invited = await inviteMember(repos, {
      projectId: 'p1',
      email: 'j.park@lab.edu',
      role: 'editor',
      now: LATER,
    });
    await removeMember(repos, { projectId: 'p1', userId: invited.userId, now: LATER });

    expect(await listMembers(repos, 'p1')).toHaveLength(1);
    expect((await repos.users.get(invited.userId))?.rolesPerProject['p1']).toBeUndefined();
  });

  it('refuses to remove the last owner', async () => {
    await expect(
      removeMember(repos, { projectId: 'p1', userId: 'me', now: LATER }),
    ).rejects.toThrow(/at least one owner/);
  });
});
