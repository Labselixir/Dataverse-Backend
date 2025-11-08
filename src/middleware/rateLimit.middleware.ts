import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';
import { CONSTANTS } from '../utils/constants';
import { RateLimitError } from '../utils/errors';

export const rateLimitMiddleware = rateLimit({
  windowMs: CONSTANTS.RATE_LIMIT.WINDOW_MS,
  max: CONSTANTS.RATE_LIMIT.MAX_REQUESTS,
  message: CONSTANTS.RESPONSE_MESSAGES.RATE_LIMIT_EXCEEDED,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    throw new RateLimitError();
  }
});

export const aiRateLimitMiddleware = rateLimit({
  windowMs: CONSTANTS.RATE_LIMIT.WINDOW_MS,
  max: CONSTANTS.RATE_LIMIT.AI_MAX_REQUESTS,
  message: 'AI request limit exceeded. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    // Rate limit per user for AI requests
    const authHeader = req.headers.authorization;
    if (authHeader) {
      return authHeader;
    }
    return req.ip || 'anonymous';
  },
  handler: (req: Request, res: Response) => {
    throw new RateLimitError('AI request limit exceeded');
  }
});

export const authRateLimitMiddleware = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: 'Too many authentication attempts. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful requests
  handler: (req: Request, res: Response) => {
    throw new RateLimitError('Too many authentication attempts');
  }
});