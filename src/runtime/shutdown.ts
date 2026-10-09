/**
 * Cloud Run delivers SIGTERM before stopping a container. Without process
 * handlers, close() on the API/worker is never invoked in a normal deployment.
 * Make teardown idempotent so overlapping termination signals cannot close a
 * listener or database pool twice. The runtime argument is injectable for tests.
 */
export interface ShutdownSignals {
  on(event:"SIGTERM"|"SIGINT",handler:()=>void):unknown;
  off(event:"SIGTERM"|"SIGINT",handler:()=>void):unknown;
  exitCode?:number|string|null;
}
export function installGracefulShutdown(
  close:()=>Promise<void>,
  runtime:ShutdownSignals=process,
  report:(message:string)=>void=(message)=>console.error(message)
):()=>void{
  let stopping=false;
  const handler=()=>{
    if(stopping)return;
    stopping=true;
    // Explicitly track errors so a failed cleanup is not reported as success.
    void Promise.resolve().then(close).catch(error=>{
      runtime.exitCode=1;
      report(`TeamChat shutdown failed: ${error instanceof Error?error.message:"unknown error"}`);
    }).finally(()=>{
      runtime.off("SIGTERM",handler);
      runtime.off("SIGINT",handler);
    });
  };
  runtime.on("SIGTERM",handler);
  runtime.on("SIGINT",handler);
  return ()=>{
    runtime.off("SIGTERM",handler);
    runtime.off("SIGINT",handler);
  };
}
