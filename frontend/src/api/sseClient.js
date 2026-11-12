export function parseSseEvent(block) {
  let id='';const data=[];
  for(const line of block.split('\n')){if(!line||line.startsWith(':'))continue;const separator=line.indexOf(':');const field=separator<0?line:line.slice(0,separator);let value=separator<0?'':line.slice(separator+1);if(value.startsWith(' '))value=value.slice(1);if(field==='id'&&!value.includes('\0'))id=value;if(field==='data')data.push(value);}
  return data.length?{lastEventId:id,data:data.join('\n')}:null;
}

export async function openAuthenticatedEventStream({ url, token='', lastEventId='', signal, onOpen=()=>{}, onMessage=()=>{}, fetchImpl=globalThis.fetch }={}) {
  const headers={Accept:'text/event-stream',...(token?{Authorization:`Bearer ${token}`}:{}) ,...(lastEventId?{'Last-Event-ID':lastEventId}:{})};
  const response=await fetchImpl(url,{method:'GET',headers,signal,cache:'no-store'});
  if(!response.ok)throw Object.assign(new Error(`Event stream returned HTTP ${response.status}.`),{status:response.status,code:'SSE_HTTP_ERROR'});
  if(!response.body)throw Object.assign(new Error('Event stream response has no body.'),{code:'SSE_BODY_MISSING'});
  onOpen();const reader=response.body.getReader();const decoder=new TextDecoder();let buffer='';let latestId=lastEventId;
  while(true){const {done,value}=await reader.read();buffer+=decoder.decode(value??new Uint8Array(),{stream:!done}).replace(/\r\n/g,'\n');let boundary;while((boundary=buffer.indexOf('\n\n'))>=0){const parsed=parseSseEvent(buffer.slice(0,boundary));buffer=buffer.slice(boundary+2);if(parsed){if(parsed.lastEventId)latestId=parsed.lastEventId;onMessage({...parsed,lastEventId:parsed.lastEventId||latestId});}}if(done)break;}
  return latestId;
}
