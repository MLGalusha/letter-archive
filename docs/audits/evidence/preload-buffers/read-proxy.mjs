import http from 'node:http';
import { Readable } from 'node:stream';
http.createServer(async (req,res)=>{
  res.setHeader('Access-Control-Allow-Origin',req.headers.origin ?? '*');
  res.setHeader('Access-Control-Allow-Credentials','true');
  if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Headers','content-type');res.writeHead(204);res.end();return;}
  if(req.method!=='GET'){res.writeHead(405);res.end();return;}
  try{
    const target=new URL(req.url,'https://api.voicesthatremain.com');
    if(target.origin!=='https://api.voicesthatremain.com'){res.writeHead(400);res.end();return;}
    const upstream=await fetch(target,{headers:{accept:req.headers.accept ?? '*/*'}});
    res.statusCode=upstream.status;
    for(const [key,value]of upstream.headers)if(!['content-encoding','content-length','transfer-encoding','connection','access-control-allow-origin','access-control-allow-credentials'].includes(key))res.setHeader(key,value);
    if(upstream.body)Readable.fromWeb(upstream.body).pipe(res);else res.end();
  }catch{res.writeHead(502);res.end();}
}).listen(3009,'127.0.0.1');
