import {env} from 'cloudflare:workers';
import {submissionRuntimeRequest,type SubmissionRuntimeBindings} from '@/lib/submission-runtime';
export const dynamic='force-dynamic';
async function submissionRequest(request:Request){return submissionRuntimeRequest(request,env as unknown as SubmissionRuntimeBindings);}
export {submissionRequest as POST};
