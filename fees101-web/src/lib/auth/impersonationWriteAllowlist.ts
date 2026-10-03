// Permissions a platform admin's read-only impersonation session is allowed to
// exercise even though they're in the DO (action) group — see can() in
// permissions.ts. Deliberately empty: impersonation is view-only, full stop.
// Any future exception needs a real product decision, not a default.
export const IMPERSONATION_WRITE_ALLOWLIST = new Set<string>([])
