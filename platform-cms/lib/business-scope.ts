/** Owner scope decision,29Oct2026: preserve existing WordPress/Grow business
 * processes. Native replacements are frozen code, never deployment/env flags.
 * Unfreezing requires an explicit new owner scope decision and code review. */
export const NATIVE_COMMERCE_ENABLED=false;
export const NATIVE_FORM_REPLACEMENT_ENABLED=false;
export const EXISTING_BUSINESS_ADMIN='https://derech-tkuma.com/wp-admin/';
export function frozenBusinessResponse(){return Response.json({accepted:false,code:'native_business_frozen'},{status:503,headers:{'cache-control':'private, no-store','x-robots-tag':'noindex, nofollow','referrer-policy':'no-referrer','x-content-type-options':'nosniff'}});}
