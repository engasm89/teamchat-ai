import {startApi} from "./http-socket.ts";
import {installGracefulShutdown} from "../runtime/shutdown.ts";

startApi().then(running=>{
  installGracefulShutdown(()=>running.close());
  console.log("TeamChat API listening");
}).catch(error=>{
  console.error("TeamChat API failed to start",error);
  process.exitCode=1;
});
