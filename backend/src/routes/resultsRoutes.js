import { Router } from 'express';
import * as controller from '../controllers/resultsController.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { resultParamsSchema } from '../validators/configValidator.js';

const router = Router();
router.get('/:runId', validateRequest({ params: resultParamsSchema }), controller.listResults);
router.get('/:runId/screenshots/:filename', controller.getScreenshot);
router.post('/:runId/:rowNumber/retry', controller.retryResult);
export default router;
