import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultPath = fileURLToPath(new URL('../../../storage/field-mappings.json', import.meta.url));
const BLOCKED_TYPES = new Set(['hidden','password','file','checkbox']);
const BLOCKED_TEXT = /captcha|recaptcha|hcaptcha|turnstile|password|passcode|login|sign in|payment|credit card|debit card|card number|cvv|cvc|billing|expiry|consent|agree|terms|privacy|legal|declaration|marketing|newsletter|subscribe|opt[ -]?in|upload/;
let loadedPath = ''; let mappings = []; let mutationQueue = Promise.resolve();

const clean = (value, max = 500) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const normalize = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const domainFrom = (url) => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
const fieldLabel = (field) => clean(field.label || field.groupLabel || field.accessibleName || field.placeholder || field.name || field.id, 200);
const fieldText = (field) => normalize([field.label,field.groupLabel,field.accessibleName,field.placeholder,field.name,field.id].filter(Boolean).join(' '));
const mappingId = (domain, field, label) => createHash('sha256').update(`${domain}|${normalize(label)}|${normalize(field.type)}|${normalize(field.name)}`).digest('hex').slice(0, 20);

async function load(filePath = defaultPath) {
  const target = path.resolve(filePath); if (loadedPath === target) return;
  try { const parsed=JSON.parse(await readFile(target,'utf8')); mappings=Array.isArray(parsed.mappings)?parsed.mappings:[]; }
  catch(error){ if(error.code!=='ENOENT')throw error; mappings=[]; }
  loadedPath=target;
}

async function save(filePath = defaultPath) {
  const target=path.resolve(filePath);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,JSON.stringify({version:1,mappings},null,2),'utf8');
}

function mutate(operation, filePath = defaultPath) {
  const task=mutationQueue.then(async()=>{await load(filePath);const result=await operation();await save(filePath);return result;});mutationQueue=task.catch(()=>{});return task;
}

function safeSuggestion(field) {
  const type=normalize(field.type);const label=fieldLabel(field);
  return Boolean(label&&field.fillable!==false&&!field.disabled&&!field.readOnly&&!BLOCKED_TYPES.has(type)&&!BLOCKED_TEXT.test(fieldText(field)));
}

export async function recordFieldSuggestions({ websiteUrl, contactPageUrl = '', fields = [], filePath = defaultPath } = {}) {
  const domain=domainFrom(websiteUrl||contactPageUrl);if(!domain)return [];
  return mutate(()=>{const now=new Date().toISOString();const touched=[];
    for(const entry of fields){const field=entry.field??entry;if(!safeSuggestion(field))continue;const label=fieldLabel(field);const id=mappingId(domain,field,label);let record=mappings.find((item)=>item.id===id);
      const options=(field.options??[]).filter((option)=>!option.disabled).map((option)=>clean(option.text||option.value,120)).filter(Boolean).slice(0,30);
      if(record){record.lastSeenAt=now;record.seenCount=(record.seenCount??1)+1;record.options=[...new Set([...(record.options??[]),...options])].slice(0,30);record.contactPageUrl=clean(contactPageUrl,500)||record.contactPageUrl;}
      else{record={id,status:'pending',scope:'website',domain,fieldName:label,aliases:'',value:'',fieldType:clean(field.type,40),options,contactPageUrl:clean(contactPageUrl,500),firstSeenAt:now,lastSeenAt:now,seenCount:1};mappings.push(record);}touched.push({...record});
    }return touched;
  },filePath);
}

export async function listFieldMappings({ filePath = defaultPath } = {}) { await mutationQueue;await load(filePath);return mappings.map((mapping)=>({...mapping})).sort((a,b)=>String(b.lastSeenAt).localeCompare(String(a.lastSeenAt))); }

export async function approveFieldMapping(id, { value, aliases = '', scope = 'website' } = {}, { filePath = defaultPath } = {}) {
  const approvedValue=clean(value,1000);if(!approvedValue)throw Object.assign(new Error('An approved value is required.'),{code:'MAPPING_VALUE_REQUIRED'});
  if(!['website','global'].includes(scope))throw Object.assign(new Error('Mapping scope must be website or global.'),{code:'INVALID_MAPPING_SCOPE'});
  return mutate(()=>{const record=mappings.find((item)=>item.id===id);if(!record)throw Object.assign(new Error('Field mapping was not found.'),{code:'FIELD_MAPPING_NOT_FOUND'});record.value=approvedValue;record.aliases=clean(aliases,1000);record.scope=scope;record.status='approved';record.approvedAt=new Date().toISOString();return {...record};},filePath);
}

export async function dismissFieldMapping(id, { filePath = defaultPath } = {}) { return mutate(()=>{const record=mappings.find((item)=>item.id===id);if(!record)throw Object.assign(new Error('Field mapping was not found.'),{code:'FIELD_MAPPING_NOT_FOUND'});record.status='dismissed';record.dismissedAt=new Date().toISOString();return {...record};},filePath); }

export async function getApprovedCustomFields(websiteUrl, { filePath = defaultPath } = {}) { const domain=domainFrom(websiteUrl);const all=await listFieldMappings({filePath});return all.filter((item)=>item.status==='approved'&&(item.scope==='global'||item.domain===domain)).map((item)=>({fieldName:item.fieldName,aliases:item.aliases,value:item.value})); }

export function resetFieldMappingRegistryForTests(){loadedPath='';mappings=[];mutationQueue=Promise.resolve();}
