import { Router } from 'express';
import {
  extractSchema,
  refreshSchema,
  getCollectionSample,
  getFieldDistribution,
  detectRelationships
} from '../controllers/schema.controller';
import { validateObjectId } from '../middleware/validation.middleware';
import { authenticateUser, requireOrganization } from '../middleware/auth.middleware';

const router = Router();

router.use(authenticateUser);
router.use(requireOrganization);

router.post('/:id/extract', validateObjectId, extractSchema);
router.post('/:id/refresh', validateObjectId, refreshSchema);
router.get('/:id/collection/:name/sample', getCollectionSample);
router.get('/:id/collection/:name/field/:field/distribution', getFieldDistribution);
router.get('/:id/relationships', validateObjectId, detectRelationships);

export default router;