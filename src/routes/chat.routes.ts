import { Router } from 'express';
import {
  sendMessage,
  getChatHistory,
  clearChatHistory,
  streamMessage,
  getSuggestions,
  executeQuery
} from '../controllers/chat.controller';
import { validateSendMessage } from '../middleware/validation.middleware';
import { authenticateUser, requireOrganization } from '../middleware/auth.middleware';
import { aiRateLimitMiddleware } from '../middleware/rateLimit.middleware';

const router = Router();

router.use(authenticateUser);
router.use(requireOrganization);

// Chat operations
router.post('/message', aiRateLimitMiddleware, validateSendMessage, sendMessage);
router.post('/stream', aiRateLimitMiddleware, validateSendMessage, streamMessage);
router.get('/history/:projectId', getChatHistory);
router.delete('/history/:projectId', clearChatHistory);
router.post('/suggestions', getSuggestions);
router.post('/query', executeQuery);

export default router;