import {NO_MATCH} from "../tenant.ts";
import type {ToolName} from "../tools.ts";
/** Pure, deterministic presentation contract: model text NEVER becomes a
 * business fact. All business values remain the authoritative tool result. */
export function verifiedToolBlock(name:ToolName,result:unknown):Record<string,unknown>{
 if(result===NO_MATCH||
   (result!==null&&typeof result==="object"&&!Array.isArray(result)&&
    (result as Record<string,unknown>).found===false&&
    (result as Record<string,unknown>).message===NO_MATCH.message)||
   (Array.isArray(result)&&result.length===0)){
  const message=name==="search_memory"?"I have no record of that.":
   name==="search_catalog"||name==="get_catalog_code"?"No matching product exists in the supplied catalog.":
   "No matching record is available in this workspace.";
  return {template:"missing",values:{message},source:"verified_database_tool"};
 }
 return {template:name,result,source:"verified_database_tool"};
}
