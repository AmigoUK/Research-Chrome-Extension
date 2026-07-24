/**
 * The local user's identity.
 *
 * Without a backend there are no accounts: every surface writes as one person,
 * under the id the side panel and the dashboard have always used as the project
 * owner. It lives in the core because the router stamps it on activity events,
 * not just the UI.
 */
import type { Id } from './types';

export const SELF_USER_ID: Id = 'me';
