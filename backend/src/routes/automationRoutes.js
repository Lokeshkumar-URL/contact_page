import { Router } from 'express';
import { z } from 'zod';
import * as controller from '../controllers/automationController.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { runParamsSchema, startRunSchema } from '../validators/configValidator.js';

const router = Router();
router.get('/', controller.getRunHistory);
router.post('/start', validateRequest({ body: startRunSchema }), controller.start);
router.post('/bulk-delete', validateRequest({ body: z.object({ runIds: z.array(z.string().uuid()).min(1).max(200) }).strict() }), controller.bulkRemove);
router.delete('/:runId', validateRequest({ params: runParamsSchema }), controller.remove);
router.post('/:runId/pause', validateRequest({ params: runParamsSchema }), controller.pause);
router.post('/:runId/resume', validateRequest({ params: runParamsSchema }), controller.resume);
router.post('/:runId/stop', validateRequest({ params: runParamsSchema }), controller.stop);
router.get('/:runId', validateRequest({ params: runParamsSchema }), controller.getRunStatus);
router.get('/:runId/events', validateRequest({ params: runParamsSchema }), controller.streamRunEvents);
export default router;
