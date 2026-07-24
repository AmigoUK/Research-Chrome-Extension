import { describe, it, expect } from 'vitest';
import {
  CAPABILITIES,
  CAPABILITY_LABELS,
  ROLES,
  can,
  roleOf,
  activeOwners,
  keepsAnOwner,
} from './roles';
import type { ProjectMember } from './types';

const members: ProjectMember[] = [
  { userId: 'owner-1', role: 'owner' },
  { userId: 'editor-1', role: 'editor' },
  { userId: 'viewer-1', role: 'viewer' },
  { userId: 'invited-1', role: 'owner', pending: true },
];

describe('capability matrix', () => {
  it('labels every capability', () => {
    for (const capability of CAPABILITIES) {
      expect(CAPABILITY_LABELS[capability]).toBeTruthy();
    }
  });

  it('gives the owner everything', () => {
    for (const capability of CAPABILITIES) expect(can('owner', capability)).toBe(true);
  });

  it('lets an editor work on content but not administer the project', () => {
    expect(can('editor', 'annotate')).toBe(true);
    expect(can('editor', 'editStatus')).toBe(true);
    expect(can('editor', 'manageReferences')).toBe(true);
    expect(can('editor', 'manageMembers')).toBe(false);
    expect(can('editor', 'deleteProject')).toBe(false);
  });

  it('limits a viewer to reading and exporting', () => {
    expect(can('viewer', 'readExport')).toBe(true);
    for (const capability of CAPABILITIES.filter((c) => c !== 'readExport')) {
      expect(can('viewer', capability)).toBe(false);
    }
  });

  it('grants nothing to a non-member', () => {
    for (const capability of CAPABILITIES) expect(can(undefined, capability)).toBe(false);
  });

  it('orders roles from most to least privileged', () => {
    expect(ROLES).toEqual(['owner', 'editor', 'viewer']);
  });
});

describe('membership helpers', () => {
  it('finds the role a user holds, or undefined for a stranger', () => {
    expect(roleOf(members, 'editor-1')).toBe('editor');
    expect(roleOf(members, 'nobody')).toBeUndefined();
  });

  it('counts only owners who have accepted the invitation', () => {
    expect(activeOwners(members).map((m) => m.userId)).toEqual(['owner-1']);
  });

  it('refuses to leave a project without an owner', () => {
    expect(keepsAnOwner(members, 'owner-1')).toBe(false);
    expect(keepsAnOwner(members, 'owner-1', 'owner')).toBe(true);
    expect(keepsAnOwner(members, 'editor-1')).toBe(true);
    const twoOwners: ProjectMember[] = [...members, { userId: 'owner-2', role: 'owner' }];
    expect(keepsAnOwner(twoOwners, 'owner-1')).toBe(true);
  });
});
