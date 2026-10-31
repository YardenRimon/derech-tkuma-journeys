/** Actual page+shell SSR with injected auth/synthetic snapshot. No DB/provider IO. */
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {renderToStaticMarkup} from 'react-dom/server';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.setUncaughtExceptionCaptureCallback(error=>{console.error(error.name+': '+error.message.slice(0,1000));process.exitCode=1;});
const root=fileURLToPath(new URL('../',import.meta.url));
const fixture={schema:1,snapshotAt:'2026-10-31T21:00:00Z',stage:'local-preparation',reviewOrigin:'https://derech-tkuma-review.22yarden22.workers.dev',deployedCommit:'a'.repeat(40),connections:[{id:'source-forms',title:'טפסי המקור',asset:'WordPress דרך התקומה',capability:'קליטת הטפסים הקיימים',technicalStatus:'awaiting_owner',requiredFor:'public_continuity',fallback:'להשאיר את האתר המקורי פעיל',status:'blocked',checkedAt:null,evidence:[],missing:'ניתוב המקור טרם אומת',owner:'צוות הפיתוח',nextStep:'לבדוק מקומית את המשך השימוש ב־WordPress',impact:'נדרשת בדיקת רציפות לפני מעבר'}]};
const dataImport=async text=>import('data:text/javascript;base64,'+Buffer.from(text).toString('base64'));
const parserBuild=await build({entryPoints:[root+'lib/integration-readiness.ts'],bundle:true,write:false,platform:'node',format:'esm',target:'es2022'});
const {parseIntegrationReadiness,readinessDateLabel,technicalStatuses,readinessRequirements}=await dataImport(parserBuild.outputFiles[0].text);
assert.deepEqual(parseIntegrationReadiness(fixture),fixture);const parsed=parseIntegrationReadiness(fixture);parsed.connections[0].missing='changed';assert.notEqual(parsed.connections[0].missing,fixture.connections[0].missing);
const invalid=change=>{const value=structuredClone(fixture);change(value);assert.throws(()=>parseIntegrationReadiness(value),/readiness_snapshot_invalid/);};
for(const name of ['asset','capability','technicalStatus','requiredFor','fallback'])invalid(v=>delete v.connections[0][name]);
invalid(v=>v.connections[0].asset='');invalid(v=>v.connections[0].technicalStatus='connected');invalid(v=>v.connections[0].requiredFor='ready');
for(const technicalStatus of technicalStatuses){const value=structuredClone(fixture);value.connections[0].technicalStatus=technicalStatus;if(['verified_read','verified_action'].includes(technicalStatus)){invalid(v=>v.connections[0].technicalStatus=technicalStatus);Object.assign(value.connections[0],{status:'live_verified',checkedAt:'2026-10-31T20:00:00Z',evidence:[{label:'ראיית בדיקה',reference:'docs/migration-handoff.md'}]});for(const status of ['historical','local_verified']){const wrong=structuredClone(value);wrong.connections[0].status=status;assert.throws(()=>parseIntegrationReadiness(wrong),/readiness_snapshot_invalid/);}}assert.equal(parseIntegrationReadiness(value).connections[0].technicalStatus,technicalStatus);}
for(const requiredFor of readinessRequirements){const value=structuredClone(fixture);value.connections[0].requiredFor=requiredFor;assert.equal(parseIntegrationReadiness(value).connections[0].requiredFor,requiredFor);}
invalid(v=>v.ready=true);invalid(v=>v.stage='production');invalid(v=>v.reviewOrigin='https://foreign.invalid');invalid(v=>v.deployedCommit='main');invalid(v=>v.connections.push(structuredClone(v.connections[0])));
for(const state of ['live_verified','local_verified','historical']){invalid(v=>v.connections[0].status=state);const good=structuredClone(fixture);Object.assign(good.connections[0],{status:state,checkedAt:'2026-10-29T05:01:41.000Z',evidence:[{label:'מסמך מסירה',reference:'docs/migration-handoff.md#readiness'}]});assert.equal(parseIntegrationReadiness(good).connections[0].status,state);}
invalid(v=>v.connections[0].checkedAt='2026-11-01T00:00:00Z');invalid(v=>v.snapshotAt='2026-02-30T21:00:00Z');invalid(v=>v.connections[0].checkedAt='not-a-date');invalid(v=>v.connections[0].owner='');invalid(v=>v.connections[0].nextStep='x'.repeat(901));
for(const secret of ['Authorization: Bearer private-fixture','api_key=private-fixture','client_secret=private-fixture','Cookie: private-fixture','https://provider.invalid/callback?token=private-fixture','-----BEGIN PRIVATE KEY-----','synthetic-person@example.test'])invalid(v=>v.connections[0].missing=secret);
for(const reference of ['docs/../private.md','/Users/private.md','https://provider.invalid/callback','https://derech-tkuma.com/?wc-api=private-fixture','docs/site.md?token=x','https://github.com/YardenRimon/other/actions/runs/123'])invalid(v=>v.connections[0].evidence=[{label:'מקור',reference}]);
assert.match(readinessDateLabel('2026-10-31T21:00:00Z'),/23:00/);assert.equal(readinessDateLabel(null),'לא נרשמה בדיקה');
const state=globalThis.__readinessFixture={role:'system_admin',calls:[],signedIn:true};
const output=await build({entryPoints:[root+'app/admin/readiness/page.tsx'],bundle:true,write:false,platform:'node',format:'esm',target:'es2022',jsx:'automatic',plugins:[{name:'readiness-isolated-auth',setup(builder){
 builder.onResolve({filter:/^(?:react(?:\/(?:jsx-runtime|jsx-dev-runtime))?|lucide-react)$/},({path})=>({path:pathToFileURL(require.resolve(path)).href,external:true}));
 builder.onResolve({filter:/^@\/app\/chatgpt-auth$/},()=>({path:'auth',namespace:'fixture'}));
 builder.onResolve({filter:/^@\/lib\/access$/},()=>({path:'access',namespace:'fixture'}));
 builder.onResolve({filter:/^@\/lib\/integration-readiness-snapshot\.json$/},()=>({path:'snapshot',namespace:'fixture'}));
 builder.onResolve({filter:/^@\/lib\/integration-readiness$/},()=>({path:root+'lib/integration-readiness.ts'}));
 builder.onResolve({filter:/^@\/lib\/visitor-release$/},()=>({path:'release',namespace:'fixture'}));
 builder.onResolve({filter:/^\.\/AdminNavigation$/},()=>({path:'nav',namespace:'fixture'}));
 builder.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({loader:'js',contents:path==='auth'?`export async function requireChatGPTUser(path){const s=globalThis.__readinessFixture;s.calls.push(['signed-in',path]);if(!s.signedIn)throw new Error('unauthenticated');}export const getAuthProvider=()=> 'supabase',chatGPTSignOutPath=()=>'/login/?logout=1';`:path==='access'?`export class CmsError extends Error {constructor(status,message){super(message);this.status=status;}}export async function authorizeCmsUser(permission){const s=globalThis.__readinessFixture;s.calls.push(['permission',permission]);return {email:'owner@example.test',role:s.role};}`:path==='snapshot'?'export default '+JSON.stringify(fixture):path==='release'?'export const productionRelease=()=>null;':`export default function Navigation({children}){return children;}`}));
}}]});
const page=await dataImport(output.outputFiles[0].text);
assert.deepEqual(page.metadata,{robots:{index:false,follow:false}});
let html=renderToStaticMarkup(await page.default());assert.deepEqual(state.calls,[['signed-in','/admin/readiness'],['permission','users']]);
assert.match(html,/חיבורים ומוכנות למעבר/);assert.match(html,/תמונת הכנה מקומית/);assert.match(html,/אינם מתרעננים אוטומטית/);assert.match(html,/WordPress/);assert.match(html,/Grow/);assert.match(html,/לא נרשמה בדיקה/);assert.match(html,/נדרשת בדיקת רציפות/);assert.match(html,/מצב טכני: ממתין לפעולת בעל הנכס/);assert.match(html,/סוג הראיה: מידע על חסם/);assert.match(html,/WordPress דרך התקומה/);assert.match(html,/קליטת הטפסים הקיימים/);assert.match(html,/נדרש לרציפות האתר הציבורי/);assert.match(html,/חלופה בטוחה/);assert.match(html,/להשאיר את האתר המקורי פעיל/);assert.match(html,/href="\/admin\/readiness" aria-current="page"/);assert.equal((html.match(/<header\b/g)||[]).length,1);assert.equal((html.match(/<footer\b/g)||[]).length,1);assert.match(html,/לוגו-דרך-התקומה/);assert(!/<table\b/.test(html));assert(!/<script\b/.test(html));
state.role='content_editor';await assert.rejects(()=>page.default(),error=>error.status===403);state.signedIn=false;state.calls=[];await assert.rejects(()=>page.default(),/unauthenticated/);assert.equal(state.calls.length,1,'anonymous request must not reach authorization or evidence rendering');
delete globalThis.__readinessFixture;
console.log('PASS local readiness: strict bounded contract-aligned asset/capability/status/launch/fallback snapshot, separate technical/evidence states, evidence-only verified states, immutable copy/date validity, secret/query/private-reference refusal; actual branded page/shell SSR, noindex, admin permission and anonymous/editor denial. No provider/DB/network requests. Browser visual acceptance remains separate.');
