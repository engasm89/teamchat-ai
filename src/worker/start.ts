import {startWorker} from "./http.ts";
startWorker().then(()=>console.log("TeamChat private worker listening")).catch(e=>{console.error(e);process.exitCode=1;});
