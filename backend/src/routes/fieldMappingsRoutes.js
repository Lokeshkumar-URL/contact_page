import { Router } from 'express';
import * as controller from '../controllers/fieldMappingsController.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { approveFieldMappingSchema, fieldMappingParamsSchema } from '../validators/fieldMappingsValidator.js';

const router=Router();router.get('/',controller.list);router.post('/:mappingId/approve',validateRequest({params:fieldMappingParamsSchema,body:approveFieldMappingSchema}),controller.approve);router.post('/:mappingId/dismiss',validateRequest({params:fieldMappingParamsSchema}),controller.dismiss);export default router;
