// Deliberately separate from the production asset server and release packages.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const paths = new Map([
  ['/', ['experiments/presence/index.html','text/html']],
  ['/index.html', ['experiments/presence/index.html','text/html']],
  ['/presence.css', ['experiments/presence/presence.css','text/css']],
  ['/presence.js', ['experiments/presence/presence.js','text/javascript']],
  ['/src/core/presence.js', ['src/core/presence.js','text/javascript']],
]);
const port=Number(process.env.PORT||4179);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid preview port.');
createServer(async(request,response)=>{
  if(request.headers.host!==`127.0.0.1:${port}`&&request.headers.host!==`localhost:${port}`){response.writeHead(421).end();return;}
  if(!['GET','HEAD'].includes(request.method)){response.writeHead(405).end();return;}
  let entry;
  try{entry=paths.get(new URL(request.url,'http://127.0.0.1').pathname);}catch{response.writeHead(400).end();return;}
  if(!entry){response.writeHead(404).end('Not found');return;}
  try{
    const body=await readFile(new URL(entry[0],root));
    response.writeHead(200,{'Content-Type':`${entry[1]}; charset=utf-8`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'self'; connect-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"});
    response.end(request.method==='HEAD'?undefined:body);
  }catch{response.writeHead(500).end('Preview asset unavailable');}
}).listen(port,'127.0.0.1',()=>console.log(`Presence preview: http://127.0.0.1:${port}`));
