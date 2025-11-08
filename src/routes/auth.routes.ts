import { Router } from 'express';
import {
  signup,
  login,
  logout,
  refreshToken,
  forgotPassword,
  resetPassword,
  getCurrentUser,
  updateProfile
} from '../controllers/auth.controller';
import {
  validateSignup,
  validateLogin
} from '../middleware/validation.middleware';
import { authenticateUser } from '../middleware/auth.middleware';
import { authRateLimitMiddleware } from '../middleware/rateLimit.middleware';

const router = Router();

// Public routes
router.post('/signup', authRateLimitMiddleware, validateSignup, signup);
router.post('/login', authRateLimitMiddleware, validateLogin, login);
router.post('/logout', logout);
router.post('/refresh-token', refreshToken);
router.post('/forgot-password', authRateLimitMiddleware, forgotPassword);
router.post('/reset-password', authRateLimitMiddleware, resetPassword);

// Protected routes
router.get('/me', authenticateUser, getCurrentUser);
router.patch('/profile', authenticateUser, updateProfile);

export default router;