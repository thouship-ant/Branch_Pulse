/** The password rules (same as the API): shown as a live checklist and used to enable Submit. */
export const PASSWORD_RULES: Array<{ key: string; label: string; test: (pw: string) => boolean }> = [
  { key: 'len', label: 'At least 8 characters', test: (p) => p.length >= 8 },
  { key: 'upper', label: 'One uppercase letter (A-Z)', test: (p) => /[A-Z]/.test(p) },
  { key: 'lower', label: 'One lowercase letter (a-z)', test: (p) => /[a-z]/.test(p) },
  { key: 'digit', label: 'One number (0-9)', test: (p) => /\d/.test(p) },
  { key: 'special', label: 'One special character (@, #, $ ...)', test: (p) => /[^A-Za-z0-9]/.test(p) },
];

export const passwordOk = (pw: string) => PASSWORD_RULES.every((r) => r.test(pw));
