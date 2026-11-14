import { Router } from 'express';
import { z } from 'zod';
import * as controller from '../controllers/resultsController.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { resultParamsSchema } from '../validators/configValidator.js';

const router = Router();
router.get('/:runId', validateRequest({ params: resultParamsSchema }), controller.listResults);
router.get('/:runId/screenshots/:filename', controller.getScreenshot);
router.post('/:runId/bulk-delete', validateRequest({ params: resultParamsSchema, body: z.object({ rowNumbers: z.array(z.number().int().min(2)).min(1).max(5000) }).strict() }), controller.bulkDeleteResults);
router.delete('/:runId/:rowNumber', validateRequest({ params: resultParamsSchema.extend({ rowNumber: z.coerce.number().int().min(2) }) }), controller.deleteResult);
router.post('/:runId/:rowNumber/retry', controller.retryResult);
export default router;
