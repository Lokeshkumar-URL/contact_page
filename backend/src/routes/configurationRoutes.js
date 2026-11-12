import { Router } from 'express';
import * as controller from '../controllers/configurationController.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { automationConfigSchema } from '../validators/configValidator.js';

const router = Router();
router.get('/', controller.getConfiguration);
router.post('/validate', validateRequest({ body: automationConfigSchema }), controller.validateConfiguration);
export default router;
