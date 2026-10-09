import {startWorker} from "./http.ts";
import {installGracefulShutdown} from "../runtime/shutdown.ts";

startWorker().then(running=>{
  installGracefulShutdown(()=>running.close());
  console.log("TeamChat private worker listening");
}).catch(error=>{
  console.error("TeamChat worker failed to start",error);
  process.exitCode=1;
});
