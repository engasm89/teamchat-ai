import {startApi} from "./http-socket.ts";
startApi().then(()=>console.log("TeamChat API listening")).catch(e=>{console.error(e);process.exitCode=1;});
