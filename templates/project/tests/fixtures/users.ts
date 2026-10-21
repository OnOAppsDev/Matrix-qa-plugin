/**
 * Predefined test users. Credentials come only from environment variables
 * (.env locally, CI secrets in pipelines) — never write them in this file.
 * Add a role by adding an entry and the matching variables to .env.example.
 */
export const USER_ROLES = {
  standard: { usernameVar: 'MQA_USER_STANDARD_USERNAME', passwordVar: 'MQA_USER_STANDARD_PASSWORD' },
} as const;

export type UserRole = keyof typeof USER_ROLES;

export interface TestUser {
  role: UserRole;
  username: string;
  password: string;
}

function required(name: string): string {
  const value = process.env[name];
  // The message names the variable, never its value.
  if (!value) throw new Error(`Missing environment variable ${name}. Copy .env.example to .env and set it locally, or provide it as a CI secret.`);
  return value;
}

export function getUser(role: UserRole): TestUser {
  const vars = USER_ROLES[role];
  return { role, username: required(vars.usernameVar), password: required(vars.passwordVar) };
}
