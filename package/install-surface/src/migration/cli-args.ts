/** Closed CLI grammar. References are private inputs, never authority or argv.
 * The only default reader loads an explicitly named already-public snapshot.
 */
import { createMigrationController, readSuppliedMigrationSnapshot, validateMigrationRequest, migrationExitCode, type MigrationRequest, type MigrationOwnerPorts, type MigrationCommandResult, type MigrationCode } from './controller.ts';
export interface MigrationCliArgs {json:boolean;tui?:true;request:MigrationRequest|null;snapshotPath?:string}
export class MigrationArgumentError extends Error {readonly code='ARGUMENT_INVALID';constructor(){super('ARGUMENT_INVALID');}}
const bad=():never=>{throw new MigrationArgumentError();};
/** Copy only dense ordinary own string data. No caller iterator, method or
 * accessor is evaluated. Proxy reflection traps remain a JavaScript boundary:
 * detectable malformed/throwing proxies fail safely, but transparent proxies
 * cannot be universally identified and this guard is not a hostile-code sandbox.
 */
function copyArgumentData(argv:unknown):string[] {
  try {
    if(!Array.isArray(argv)||Object.getPrototypeOf(argv)!==Array.prototype)return bad();
    const descriptors=Object.getOwnPropertyDescriptors(argv as object),length=descriptors.length;
    if(!length||!('value' in length)||typeof length.value!=='number'||!Number.isSafeInteger(length.value)||length.value<0||length.value>16||Reflect.ownKeys(descriptors).length!==length.value+1)return bad();
    const args:string[]=[];
    for(let i=0;i<length.value;i++) {
      const item=descriptors[String(i)];
      if(!item||!('value' in item)||!item.enumerable||typeof item.value!=='string'||!item.value.length||item.value.length>4096||/[\x00-\x1f\x7f]/.test(item.value))return bad();
      args.push(item.value);
    }
    return args;
  }catch{return bad();}
}
export function parseMigrationArgs(argv:readonly string[]):MigrationCliArgs {
  const args=copyArgumentData(argv);
  const command=args[0]&&!args[0].startsWith('-')?args.shift()!:null;
  const grammar:Record<string,readonly string[]>={
    view:['--snapshot','--json','--tui'],inspect:['--json'],export:['--manifest-only','--output','--json'],diff:['--bundle','--host-binding','--json'],plan:['--profile','--json'],apply:['--plan','--reviewed-digest','--json'],resume:['--operation','--reviewed-digest','--json'],status:['--operation','--json'],rollback:['--operation','--reviewed-digest','--json'],release:['--operation','--reviewed-digest','--json'],cancel:['--json'],'request-sign-in':['--json'],
  };
  if(command!==null&&(!Object.hasOwn(grammar,command)||command==='view'))return bad();
  const allowed=grammar[command??'view'];if(!allowed)return bad();
  const flags=new Map<string,string|true>();
  for(let i=0;i<args.length;i++) {
    const flag=args[i]!;if(!allowed.includes(flag)||flags.has(flag))return bad();
    if(flag==='--json'||flag==='--manifest-only'||flag==='--tui')flags.set(flag,true);
    else {const value=args[++i];if(!value||value.startsWith('-'))return bad();flags.set(flag,value);}
  }
  const json=flags.has('--json');if(json&&flags.has('--tui'))return bad();
  if(command===null)return {json,...(flags.has('--tui')?{tui:true as const}:{}),request:null,...(flags.has('--snapshot')?{snapshotPath:flags.get('--snapshot') as string}:{})};
  let request:unknown;
  switch(command) {
    case 'inspect':case 'cancel':case 'request-sign-in':request={action:command};break;
    case 'export':request={action:command,manifest_only:flags.get('--manifest-only'),output:flags.get('--output')};break;
    case 'diff':request={action:command,bundle:flags.get('--bundle'),host_binding:flags.get('--host-binding')};break;
    case 'plan':request={action:command,profile:flags.get('--profile')};break;
    case 'apply':request={action:command,plan:flags.get('--plan'),reviewed_digest:flags.get('--reviewed-digest')};break;
    case 'status':request={action:command,operation:flags.get('--operation')};break;
    default:request={action:command,operation:flags.get('--operation'),reviewed_digest:flags.get('--reviewed-digest')};
  }
  if(!validateMigrationRequest(request))return bad();
  return {json,request};
}
async function failure(code:MigrationCode):Promise<MigrationCommandResult> {
  const controller=createMigrationController();
  if(code==='CANCELLED')return controller.dispatch({action:'cancel'});
  const view=controller.view();view.outcome='invalid';view.findings=[{code}];return {view,exitCode:migrationExitCode(view)};
}
/** Callable by a trusted headless host; process signals are wired only by main.
 * Production CLI injects no owner ports. No JSON option can create one.
 */
export async function runMigrationCli(argv:readonly string[],options:{ports?:MigrationOwnerPorts;snapshot?:unknown;signal?:AbortSignal;present?:(controller:ReturnType<typeof createMigrationController>,signal?:AbortSignal)=>Promise<MigrationCommandResult>}={}):Promise<MigrationCommandResult> {
  let parsed:MigrationCliArgs;try {parsed=parseMigrationArgs(argv);}catch{return failure('ARGUMENT_INVALID');}
  if(options.signal?.aborted)return failure('CANCELLED');
  let snapshot=options.snapshot;
  if(parsed.snapshotPath!==undefined) {
    if(snapshot!==undefined)return failure('ARGUMENT_INVALID');
    const loaded=await readSuppliedMigrationSnapshot(parsed.snapshotPath,{signal:options.signal});
    if(!loaded.ok)return failure(loaded.code);
    snapshot=loaded.snapshot;
  }
  const controller=createMigrationController({snapshot,ports:options.ports});
  if(controller.view().outcome==='invalid')return {view:controller.view(),exitCode:64};
  if(parsed.tui)return options.present?options.present(controller,options.signal):failure('ARGUMENT_INVALID');
  if(parsed.request)return controller.dispatch(parsed.request,{signal:options.signal});
  return {view:controller.view(),exitCode:0};
}
