import { Router } from 'express';
import {
  createOrganization,
  getOrganization,
  updateOrganization,
  inviteMember,
  removeMember,
  updateMemberRole,
  leaveOrganization,
  getMembers,
  switchOrganization
} from '../controllers/organizations.controller';
import {
  validateCreateOrganization,
  validateInviteMember,
  validateObjectId
} from '../middleware/validation.middleware';
import { authenticateUser, requireOrganization, requireRole } from '../middleware/auth.middleware';

const router = Router();

router.use(authenticateUser);

// Organization management
router.post('/', validateCreateOrganization, createOrganization);
router.get('/current', requireOrganization, getOrganization);
router.patch('/current', requireOrganization, requireRole('admin'), updateOrganization);
router.post('/switch/:id', validateObjectId, switchOrganization);

// Member management
router.get('/current/members', requireOrganization, getMembers);
router.post('/current/invite', requireOrganization, requireRole('admin'), validateInviteMember, inviteMember);
router.delete('/current/members/:userId', requireOrganization, requireRole('admin'), removeMember);
router.patch('/current/members/:userId', requireOrganization, requireRole('admin'), updateMemberRole);
router.post('/current/leave', requireOrganization, leaveOrganization);

export default router;