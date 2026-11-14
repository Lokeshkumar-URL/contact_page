import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { approveFieldMapping, dismissFieldMapping, getApprovedCustomFields, listFieldMappings, recordFieldSuggestions, resetFieldMappingRegistryForTests } from '../src/services/mappings/fieldMappingRegistry.js';

const directories=[];afterEach(async()=>{resetFieldMappingRegistryForTests();await Promise.all(directories.splice(0).map((directory)=>rm(directory,{recursive:true,force:true})));});
async function registryPath(){const directory=await mkdtemp(path.join(os.tmpdir(),'field-registry-'));directories.push(directory);return path.join(directory,'mappings.json');}
const field=(overrides={})=>({type:'select',label:'Practice size',name:'practice_size',fillable:true,disabled:false,readOnly:false,options:[{value:'small',text:'1-5',disabled:false}],...overrides});

test('safe unresolved fields are persisted and deduplicated by website',async()=>{const filePath=await registryPath();await recordFieldSuggestions({websiteUrl:'https://example.com',contactPageUrl:'https://example.com/contact',fields:[{field:field()}],filePath});await recordFieldSuggestions({websiteUrl:'https://example.com',fields:[{field:field()}],filePath});const all=await listFieldMappings({filePath});assert.equal(all.length,1);assert.equal(all[0].status,'pending');assert.equal(all[0].seenCount,2);assert.deepEqual(all[0].options,['1-5']);});

test('sensitive fields are never stored as suggestions',async()=>{const filePath=await registryPath();await recordFieldSuggestions({websiteUrl:'https://example.com',fields:[{field:field({type:'password',label:'Password'})},{field:field({label:'Credit card number'})},{field:field({type:'checkbox',label:'Accept terms'})}],filePath});assert.deepEqual(await listFieldMappings({filePath}),[]);});

test('approved website and global mappings become automation custom fields',async()=>{const filePath=await registryPath();const [suggestion]=await recordFieldSuggestions({websiteUrl:'https://example.com',fields:[{field:field()}],filePath});await approveFieldMapping(suggestion.id,{value:'1-5',aliases:'Office count',scope:'website'},{filePath});assert.equal((await getApprovedCustomFields('https://example.com/page',{filePath}))[0].value,'1-5');assert.deepEqual(await getApprovedCustomFields('https://other.example',{filePath}),[]);await approveFieldMapping(suggestion.id,{value:'1-5',aliases:'Office count',scope:'global'},{filePath});assert.equal((await getApprovedCustomFields('https://other.example',{filePath})).length,1);});

test('dismissed suggestions are retained for audit but never used',async()=>{const filePath=await registryPath();const [suggestion]=await recordFieldSuggestions({websiteUrl:'https://example.com',fields:[{field:field()}],filePath});await dismissFieldMapping(suggestion.id,{filePath});assert.equal((await listFieldMappings({filePath}))[0].status,'dismissed');assert.deepEqual(await getApprovedCustomFields('https://example.com',{filePath}),[]);});
