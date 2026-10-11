/** Local HTTP CONNECT proxy with a kill switch. cut() destroys every open
 * tunnel and refuses new ones, which a browser sees as a real TCP loss. */
import http from "node:http";
import net from "node:net";

export class CutProxy {
 private server=http.createServer((_req,res)=>{res.writeHead(405);res.end();});
 private tunnels=new Set<net.Socket>();
 private blocked=false;
 readonly log:Array<{t:number;event:"tunnel"|"refused"|"cut"|"restore";host?:string;destroyed?:number}>=[];
 port=0;

 async start():Promise<number>{
  this.server.on("connect",(req,client:net.Socket,head:Buffer)=>{
   const [host,port]=String(req.url).split(":");
   if(this.blocked){
    this.log.push({t:Date.now(),event:"refused",host});
    client.end("HTTP/1.1 503 Service Unavailable\r\n\r\n");return;
   }
   const upstream=net.connect(Number(port??443),host!,()=>{
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if(head.length)upstream.write(head);
    upstream.pipe(client);client.pipe(upstream);
   });
   this.log.push({t:Date.now(),event:"tunnel",host});
   for(const s of [client,upstream]){
    this.tunnels.add(s);
    s.on("close",()=>this.tunnels.delete(s));
    s.on("error",()=>{client.destroy();upstream.destroy();});
   }
  });
  await new Promise<void>(resolve=>this.server.listen(0,"127.0.0.1",resolve));
  this.port=(this.server.address() as net.AddressInfo).port;
  return this.port;
 }
 get url(){return `http://127.0.0.1:${this.port}`;}
 cut(){
  this.blocked=true;const destroyed=this.tunnels.size;
  for(const s of this.tunnels)s.destroy();
  this.log.push({t:Date.now(),event:"cut",destroyed});
 }
 restore(){this.blocked=false;this.log.push({t:Date.now(),event:"restore"});}
 async stop(){for(const s of this.tunnels)s.destroy();await new Promise(r=>this.server.close(r));}
}
