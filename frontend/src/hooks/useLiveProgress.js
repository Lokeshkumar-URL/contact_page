import { useEffect, useRef, useState } from 'react';
import { API_BASE_URL, currentToken } from '../api/httpClient.js';
import { openAuthenticatedEventStream } from '../api/sseClient.js';
import { EMPTY_PROGRESS, applyProgressEvent } from '../utils/progress.js';

const terminalStatuses=new Set(['completed','failed','stopped']);
const wait=(milliseconds,signal)=>new Promise((resolve)=>{const timer=setTimeout(resolve,milliseconds);signal.addEventListener('abort',()=>{clearTimeout(timer);resolve();},{once:true});});

export function useLiveProgress(runId,streamFactory=openAuthenticatedEventStream) {
  const [progress,setProgress]=useState(EMPTY_PROGRESS);const [connection,setConnection]=useState(runId?'connecting':'idle');const [runEvent,setRunEvent]=useState(null);const seenEvents=useRef(new Set());
  useEffect(()=>{const controller=new AbortController();seenEvents.current.clear();setProgress(EMPTY_PROGRESS);setRunEvent(null);if(!runId){setConnection('idle');return()=>controller.abort();}
    let terminal=false;let lastEventId='';
    const connect=async()=>{let delay=500;while(!controller.signal.aborted&&!terminal){setConnection(lastEventId?'reconnecting':'connecting');try{lastEventId=await streamFactory({url:`${API_BASE_URL}/automation/${encodeURIComponent(runId)}/events`,token:currentToken(),lastEventId,signal:controller.signal,onOpen:()=>setConnection('connected'),onMessage:(message)=>{if(message.lastEventId&&seenEvents.current.has(message.lastEventId))return;if(message.lastEventId)seenEvents.current.add(message.lastEventId);try{const event=JSON.parse(message.data);setRunEvent(event);setProgress((current)=>applyProgressEvent(current,event));terminal=terminalStatuses.has(event.status);if(terminal)setConnection('closed');}catch{setConnection('error');}}});if(!terminal&&!controller.signal.aborted)setConnection('reconnecting');}catch(error){if(controller.signal.aborted)return;setConnection(error?.status===401||error?.status===403?'unauthorized':'reconnecting');}if(!terminal&&!controller.signal.aborted){await wait(delay,controller.signal);delay=Math.min(delay*2,5000);}}};
    void connect();return()=>controller.abort();
  },[runId,streamFactory]);
  return {progress,connection,status:runEvent?.status??null,error:runEvent?.error?.message??null,eventId:runEvent?.eventId??null};
}
