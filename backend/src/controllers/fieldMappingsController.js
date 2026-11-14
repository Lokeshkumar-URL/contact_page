import { AppError } from '../errors/AppError.js';
import { approveFieldMapping, dismissFieldMapping, listFieldMappings } from '../services/mappings/fieldMappingRegistry.js';

function splitMappings(mappings){return {pending:mappings.filter((item)=>item.status==='pending'),approved:mappings.filter((item)=>item.status==='approved'),dismissed:mappings.filter((item)=>item.status==='dismissed')};}
export async function list(_request,response){response.json(splitMappings(await listFieldMappings()));}
export async function approve(request,response,next){try{response.json(await approveFieldMapping(request.params.mappingId,request.body));}catch(error){if(error.code==='FIELD_MAPPING_NOT_FOUND')return next(new AppError(404,error.code,error.message));if(['MAPPING_VALUE_REQUIRED','INVALID_MAPPING_SCOPE'].includes(error.code))return next(new AppError(400,error.code,error.message));next(error);}}
export async function dismiss(request,response,next){try{response.json(await dismissFieldMapping(request.params.mappingId));}catch(error){if(error.code==='FIELD_MAPPING_NOT_FOUND')return next(new AppError(404,error.code,error.message));next(error);}}
