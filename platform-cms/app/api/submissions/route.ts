import {NATIVE_FORM_REPLACEMENT_ENABLED,frozenBusinessResponse} from '@/lib/business-scope';
import {env} from 'cloudflare:workers';
import {submissionRuntimeRequest,type SubmissionRuntimeBindings} from '@/lib/submission-runtime';
export const dynamic='force-dynamic';
async function submissionRequest(request:Request){if(!NATIVE_FORM_REPLACEMENT_ENABLED)return frozenBusinessResponse();return submissionRuntimeRequest(request,env as unknown as SubmissionRuntimeBindings);}
export {submissionRequest as POST};
