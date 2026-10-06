import {types} from "node:util";
import {canonical} from "../canonical-json.ts";
import {evaluateGitAuthorityEligibility} from "./git-authority-contracts.ts";
export interface GitAuthorityCommandResult {readonly code:0|2;readonly stdout:string;readonly stderr:string;}

const MAX_BYTES=65536;
type ErrorCode="GIT_AUTHORITY_CLI_INVALID_ARGUMENTS"|"GIT_AUTHORITY_CLI_READ_FAILED"|"GIT_AUTHORITY_CLI_SIZE_EXCEEDED"|"GIT_AUTHORITY_CLI_INVALID_JSON"|"GIT_AUTHORITY_CLI_INVALID_CONTEXT";
const failure=(error:ErrorCode):GitAuthorityCommandResult=>({code:2,stdout:"",stderr:`${JSON.stringify({error})}\n`});
function validArgs(args:unknown):boolean {
  if(!args||typeof args!=="object"||types.isProxy(args)||!Array.isArray(args)||Object.getPrototypeOf(args)!==Array.prototype)return false;
  const ds=Object.getOwnPropertyDescriptors(args) as unknown as Record<string,PropertyDescriptor>,keys=Reflect.ownKeys(ds);
  return keys.length===2&&Object.hasOwn(ds,"length")&&Object.hasOwn(ds,"0")&&ds.length!.value===1&&Object.hasOwn(ds["0"]!,"value")&&ds["0"]!.enumerable===true&&ds["0"]!.value==="inspect";
}
/** Context-only inspection. Explicit now/reviewed fingerprint do not authenticate
 * an issuer or establish current host evidence, replay safety or claim authority. */
export async function runGitAuthorityCommand(args:string[],readInput:()=>Promise<string>|string):Promise<GitAuthorityCommandResult>{
  if(!validArgs(args))return failure("GIT_AUTHORITY_CLI_INVALID_ARGUMENTS");
  let raw:unknown;try{raw=await readInput();}catch{return failure("GIT_AUTHORITY_CLI_READ_FAILED");}
  if(typeof raw!=="string"||Buffer.byteLength(raw)>MAX_BYTES)return failure("GIT_AUTHORITY_CLI_SIZE_EXCEEDED");
  let packet:unknown;try{packet=JSON.parse(raw);}catch{return failure("GIT_AUTHORITY_CLI_INVALID_JSON");}
  try{return {code:0,stdout:canonical(evaluateGitAuthorityEligibility(packet)),stderr:""};}
  catch{return failure("GIT_AUTHORITY_CLI_INVALID_CONTEXT");}
}

/** Bound bytes before decoding and reject malformed UTF-8 instead of replacing. */
export async function readGitAuthorityStdin():Promise<string>{
  const chunks:Buffer[]=[];let size=0;
  for await(const chunk of process.stdin){const buffer=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=buffer.length;if(size>MAX_BYTES)throw new Error("GIT_AUTHORITY_CLI_STDIN_REJECTED");chunks.push(buffer);}
  return new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks));
}

// Dedicated portable entry: closure is this module, contracts, canonical JSON
// and Node built-ins. The broad interactive CLI delegates to the same runner.
if(import.meta.main){
  const result=await runGitAuthorityCommand(process.argv.slice(2),readGitAuthorityStdin);
  if(result.stdout)process.stdout.write(result.stdout);
  if(result.stderr)process.stderr.write(result.stderr);
  process.exitCode=result.code;
}
