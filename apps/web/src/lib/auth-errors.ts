/**
 * Supabase auth messages are written for developers; say them the way a
 * person would. Unknown messages pass through unchanged.
 */
export function friendlyAuthError(message: string): string {
  if (/invalid login credentials/i.test(message)) return "Incorrect email or password.";
  if (/email not confirmed/i.test(message)) {
    return "Confirm your email first — check your inbox for the link we sent.";
  }
  if (/already registered|already exists/i.test(message)) {
    return "An account with this email already exists. Sign in instead.";
  }
  if (/rate limit|too many requests/i.test(message)) {
    return "Too many attempts. Wait a minute and try again.";
  }
  return message;
}
