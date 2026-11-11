/** Read-only, transport-injected Wardveil /healthz MCP example. Never network-facing. */
import {CapabilityRegistry} from './capability-registry.mjs';
import {createMcpFixture} from './mcp-dispatcher.mjs';
import {createWardveilHealthFixtureAdapter} from '../owner-contracts/wardveil-healthz.mjs';
const hasOwn=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
function optionsSnapshot(value) {
 try {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![null,Object.prototype].includes(Object.getPrototypeOf(value))) return null;
  const keys=Reflect.ownKeys(value), allowed=['transport','permit','clock','context','authorize','maxConcurrent'];
  if(keys.some(k=>typeof k!=='string'||!allowed.includes(k)))return null;
  const descriptors=Object.getOwnPropertyDescriptors(value),result=Object.create(null);
  for(const k of keys){if(!descriptors[k]||!hasOwn(descriptors[k],'value'))return null;result[k]=descriptors[k].value;}
  return result;
 }catch{return null;}
}
export function createWardveilHealthMcpFixture(options) {
 const settings=optionsSnapshot(options);
 if(!settings||typeof settings.transport!=='function'||typeof settings.permit!=='function'||typeof settings.authorize!=='function'||!hasOwn(settings,'context'))throw new TypeError('invalid Wardveil MCP fixture options');
 const health=createWardveilHealthFixtureAdapter({
  transport:settings.transport,
  permit:settings.permit,
  ...(hasOwn(settings,'clock')?{clock:settings.clock}:{})
 });
 const registry=new CapabilityRegistry();
 registry.register({id:'wardveil.health',version:'1.0.0',owner:'wardveil',kind:'tool',access:'read',
  scopes:['status.read'],classification:'internal',timeoutMs:500,maxOutputBytes:256});
 return createMcpFixture({registry,context:settings.context,authorize:settings.authorize,
  ...(hasOwn(settings,'maxConcurrent')?{maxConcurrent:settings.maxConcurrent}:{}),
  invoke:async(capability,actor,{signal})=>{
   if(await health.authorize(actor,capability,{signal})!==true)throw new Error('owner denied');
   const status=await health.readStatus({signal});
   return JSON.stringify(status);
  }});
}
