// WQF-B — display mirror of the server's CURRENT_TERMS_VERSION
// (artifacts/api-server/src/lib/terms.ts). termsVersionDrift.test.ts fails if
// the two differ. Provisional until WQF-B9 sets the owner's approval date.
export const TERMS_VERSION = "2026-11-25";

// Owner-supplied (spec B1). Published on the Privacy Notice by design.
export const PRIVACY_CONTACT_EMAIL = "privacy@studio.networkdesignbook.com";

// True until a qualified person has reviewed the text (spec B1). WQF-B9
// deletes this flag and the banner it drives; Part B does not deploy before.
export const LEGAL_DRAFT = true;
