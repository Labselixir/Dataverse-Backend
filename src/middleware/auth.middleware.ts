import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthRequest, TokenPayload } from '../types';
import { AuthenticationError, AuthorizationError } from '../utils/errors';
import { User } from '../models/User';
import { Organization } from '../models/Organization';
import { logger } from '../utils/logger';

export const authenticateUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const token = extractToken(req);
    
    if (!token) {
      throw new AuthenticationError('No authentication token provided');
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as TokenPayload;
    
    // Verify user still exists
    const user = await User.findById(decoded.userId).select('_id email organizations');
    if (!user) {
      throw new AuthenticationError('User no longer exists');
    }
    
    req.user = {
      userId: decoded.userId,
      email: decoded.email,
      organizationId: decoded.organizationId
    };
    
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      next(new AuthenticationError('Token expired'));
    } else if (error instanceof jwt.JsonWebTokenError) {
      next(new AuthenticationError('Invalid token'));
    } else {
      next(error);
    }
  }
};

export const requireOrganization = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user?.organizationId) {
      throw new AuthorizationError('Organization membership required');
    }
    
    const organization = await Organization.findById(req.user.organizationId);
    if (!organization) {
      throw new AuthorizationError('Organization not found');
    }
    
    if (!organization.isMember(req.user.userId)) {
      throw new AuthorizationError('Not a member of this organization');
    }
    
    next();
  } catch (error) {
    next(error);
  }
};

export const requireRole = (requiredRole: 'admin' | 'editor' | 'viewer') => {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.organizationId) {
        throw new AuthorizationError('Organization membership required');
      }
      
      const organization = await Organization.findById(req.user.organizationId);
      if (!organization) {
        throw new AuthorizationError('Organization not found');
      }
      
      if (!organization.hasPermission(req.user.userId, requiredRole)) {
        throw new AuthorizationError(`${requiredRole} role required`);
      }
      
      next();
    } catch (error) {
      next(error);
    }
  };
};

export const optionalAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const token = extractToken(req);
    
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as TokenPayload;
      req.user = {
        userId: decoded.userId,
        email: decoded.email,
        organizationId: decoded.organizationId
      };
    }
    
    next();
  } catch (error) {
    // Invalid token is okay for optional auth
    logger.debug('Optional auth token invalid:', error);
    next();
  }
};

function extractToken(req: AuthRequest): string | null {
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  
  return null;
}