import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openAuthenticatedEventStream, parseSseEvent } from '../frontend/src/api/sseClient.js';

test('SSE parser supports IDs, comments, and multiline data',()=>{assert.deepEqual(parseSseEvent(': heartbeat\nid: 42\ndata: {"one":1,\ndata: "two":2}'),{lastEventId:'42',data:'{"one":1,\n"two":2}'});assert.equal(parseSseEvent(': heartbeat'),null);});

test('authenticated SSE sends bearer and resume headers and parses split chunks',async()=>{const encoded=new TextEncoder();const chunks=['id: 7\ndata: {"status":"run','ning"}\n\nid: 8\ndata: {"status":"completed"}\n\n'];const received=[];let request;
  const fetchImpl=async(_url,options)=>{request=options;return new Response(new ReadableStream({pull(controller){const next=chunks.shift();if(next===undefined)controller.close();else controller.enqueue(encoded.encode(next));}}),{status:200,headers:{'content-type':'text/event-stream'}});};
  const latest=await openAuthenticatedEventStream({url:'https://api.example/events',token:'secret-token',lastEventId:'6',fetchImpl,onMessage:(message)=>received.push(message)});
  assert.equal(request.headers.Authorization,'Bearer secret-token');assert.equal(request.headers['Last-Event-ID'],'6');assert.equal(latest,'8');assert.deepEqual(received.map((item)=>JSON.parse(item.data).status),['running','completed']);
});

test('SSE HTTP failures expose status for authorization handling',async()=>{await assert.rejects(()=>openAuthenticatedEventStream({url:'https://api.example/events',fetchImpl:async()=>new Response('',{status:401})}),(error)=>error.code==='SSE_HTTP_ERROR'&&error.status===401);});
