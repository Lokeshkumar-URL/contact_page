import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { BrowserManager } from '../src/services/browser/browserManager.js';
import { captureScreenshot } from '../src/services/browser/screenshotService.js';
import { processWebsite } from '../src/services/automation/websiteProcessor.js';

let server,baseUrl,manager,directory;
const browserE2EEnabled=process.env.RUN_BROWSER_E2E==='true';
before(async()=>{if(!browserE2EEnabled)return;const fixtures=path.resolve('backend/test/fixtures');server=http.createServer(async(req,res)=>{const file=req.url==='/contact'?'contact.html':'index.html';res.setHeader('Content-Type','text/html; charset=utf-8');res.end(await readFile(path.join(fixtures,file)));});await new Promise((resolve)=>server.listen(0,'127.0.0.1',resolve));baseUrl=`http://127.0.0.1:${server.address().port}`;manager=new BrowserManager({headless:true,navigationTimeout:15000});await manager.launch();directory=await mkdtemp(path.join(os.tmpdir(),'contact-e2e-'));});
after(async()=>{if(!browserE2EEnabled)return;await manager?.close();await new Promise((resolve)=>server?.close(resolve));if(directory)await rm(directory,{recursive:true,force:true});});

const localNavigate=async({page,url,timeout=15000})=>{const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout});return {requestedUrl:url,finalUrl:page.url(),status:response.status(),redirectCount:0,redirected:page.url()!==url};};

test('real Puppeteer completes the local contact-form pipeline in dry-run mode',{timeout:60000,skip:!browserE2EEnabled},async()=>{const result=await processWebsite({url:baseUrl,rowNumber:2},{runId:'local-e2e',config:{dryRun:true,timeoutSeconds:15},profile:{fullName:'Pat Example',email:'pat@example.com',message:'Approved fixture message'},browserManager:manager,services:{navigateSafely:localNavigate,captureScreenshot:(options)=>captureScreenshot({...options,directory})}});assert.equal(result.status,'Success');assert.equal(result.dryRun,true);assert.equal(result.contactPageUrl,`${baseUrl}/contact`);assert.equal(result.metrics.filledFields,3);await access(result.screenshot);});

test('real Puppeteer clicks an implicit submit button and verifies the local confirmation',{timeout:60000,skip:!browserE2EEnabled},async()=>{const result=await processWebsite({url:baseUrl,rowNumber:3},{runId:'local-live-e2e',config:{dryRun:false,liveConfirmed:true,timeoutSeconds:15},profile:{fullName:'Pat Example',email:'pat@example.com',message:'Approved fixture message'},browserManager:manager,liveConfirmed:true,services:{navigateSafely:localNavigate,captureScreenshot:(options)=>captureScreenshot({...options,directory})}});assert.equal(result.status,'Success');assert.equal(result.dryRun,false);assert.match(result.verificationEvidence,/thank you|message has been sent/i);await access(result.screenshot);});
