import { Router } from 'express';
import {
  createProject,
  getProjects,
  getProjectById,
  updateProject,
  deleteProject,
  duplicateProject,
  validateConnection,
  listDatabases,
  getProjectStats
} from '../controllers/projects.controller';
import {
  validateCreateProject,
  validateUpdateProject,
  validateObjectId,
  validatePagination,
  validateConnectionOnly
} from '../middleware/validation.middleware';
import { authenticateUser, requireOrganization, requireRole } from '../middleware/auth.middleware';

const router = Router();

// All routes require authentication and organization membership
router.use(authenticateUser);
router.use(requireOrganization);

// Connection validation endpoints
router.post('/validate-connection', validateConnectionOnly, validateConnection);
router.post('/list-databases', validateConnectionOnly, listDatabases);

// Project management
router.post('/', requireRole('editor'), validateCreateProject, createProject);
router.get('/', validatePagination, getProjects);
router.get('/stats', getProjectStats);
router.get('/:id', validateObjectId, getProjectById);
router.patch('/:id', requireRole('editor'), validateUpdateProject, updateProject);
router.delete('/:id', requireRole('admin'), validateObjectId, deleteProject);
router.post('/:id/duplicate', requireRole('editor'), validateObjectId, duplicateProject);

export default router;