/** Nonproduction in-process MCP JSON-RPC fixture; no listener, secrets, or writes. */
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
function record(v,keys) {
 try {
  if(!v||typeof v!=='object'||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))return null;
  const d=Object.getOwnPropertyDescriptors(v), out=Object.create(null);
  if(Reflect.ownKeys(v).some(k=>typeof k!=='string'||!keys.includes(k)))return null;
  for(const [k,descriptor] of Object.entries(d)){if(!own(descriptor,'value'))return null;out[k]=descriptor.value;}
  return out;
 }catch{return null;}
}
const err=(id,code,message)=>({jsonrpc:'2.0',id,error:{code,message}});
const ok=(id,result)=>({jsonrpc:'2.0',id,result});
const toolName=item=>item.id+'@'+item.version;
const schema={type:'object',properties:{},additionalProperties:false};
/** Inject trusted dependencies. Only zero-argument, read-only tools are supported. */
export function createMcpFixture({registry,context,authorize,invoke,protocolVersion='2025-06-18'}) {
 if(!registry||typeof registry.discover!=='function'||typeof registry.resolve!=='function'||typeof authorize!=='function'||typeof invoke!=='function'||protocolVersion!=='2025-06-18')throw new TypeError('invalid fixture dependencies');
 const list=()=>registry.discover(context,authorize).filter(item=>item.kind==='tool'&&item.access==='read');
 return Object.freeze({async handle(request){
  const r=record(request,['jsonrpc','id','method','params']);
  if(!r||r.jsonrpc!=='2.0'||typeof r.method!=='string'||r.method.length>128||!own(r,'id')||!(typeof r.id==='string'&&r.id.length<=128||Number.isSafeInteger(r.id))||(own(r,'params')&&!record(r.params,['protocolVersion','capabilities','clientInfo','name','arguments','_meta','cursor'])))return err(null,-32600,'Invalid Request');
  const {id,method}=r;
  if(method==='initialize'){
   const p=record(r.params,['protocolVersion','capabilities','clientInfo']);
   if(!p||p.protocolVersion!==protocolVersion)return err(id,-32602,'Unsupported protocol version');
   return ok(id,{protocolVersion,capabilities:{tools:{listChanged:false}},serverInfo:{name:'goreecloud-mesh-fixture',version:'0.0.1'}});
  }
  if(method==='tools/list'){
   const p=record(r.params??{},['cursor']);
   if(!p||own(p,'cursor'))return err(id,-32602,'Invalid params');
   return ok(id,{tools:list().map(item=>({name:toolName(item),description:'Read-only development fixture',inputSchema:schema}))});
  }
  if(method==='tools/call'){
   const p=record(r.params,['name','arguments','_meta']);
   if(!p||typeof p.name!=='string'||p.name.length>300||(own(p,'arguments')&&(!record(p.arguments,[])||Reflect.ownKeys(p.arguments).length!==0))||own(p,'_meta'))return err(id,-32602,'Invalid params');
   const match=list().find(item=>toolName(item)===p.name);
   if(!match)return err(id,-32602,'Unknown or unauthorized tool');
   const item=registry.resolve(match.id,match.version,context,authorize);
   if(!item||item.kind!=='tool'||item.access!=='read')return err(id,-32602,'Unauthorized tool');
   try{
    const output=await invoke(item,context);
    if(typeof output!=='string'||Buffer.byteLength(output,'utf8')>item.maxOutputBytes)throw Error('invalid response');
    return ok(id,{content:[{type:'text',text:output}],isError:false});
   }catch{return ok(id,{content:[{type:'text',text:'Owner unavailable'}],isError:true});}
  }
  return err(id,-32601,'Method not found');
 }});
}
