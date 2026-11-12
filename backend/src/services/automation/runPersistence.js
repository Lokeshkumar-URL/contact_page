import { mkdir,readFile,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { listRuns,restoreJobState,subscribeToAllRuns } from './jobState.js';
const defaultPath=path.resolve('backend/storage/runs.json');let timer;let unsubscribe;
export async function saveRunState(filePath=defaultPath){const target=path.resolve(filePath);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,JSON.stringify({version:1,runs:listRuns()},null,2),'utf8');}
export async function loadRunState(filePath=defaultPath){try{const parsed=JSON.parse(await readFile(path.resolve(filePath),'utf8'));return restoreJobState(Array.isArray(parsed.runs)?parsed.runs:[]);}catch(error){if(error.code==='ENOENT')return [];throw error;}}
export function startRunPersistence(filePath=defaultPath,{delay=100}={}){unsubscribe?.();unsubscribe=subscribeToAllRuns(()=>{clearTimeout(timer);timer=setTimeout(()=>void saveRunState(filePath),delay);timer.unref?.();});return()=>{unsubscribe?.();unsubscribe=null;clearTimeout(timer);};}
export async function flushRunPersistence(filePath=defaultPath){clearTimeout(timer);await saveRunState(filePath);}
