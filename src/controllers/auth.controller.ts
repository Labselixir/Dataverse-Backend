import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { User } from '../models/User';
import { Organization } from '../models/Organization';
import { AuthRequest, TokenPayload } from '../types';
import { 
  AuthenticationError, 
  ConflictError, 
  NotFoundError, 
  ValidationError 
} from '../utils/errors';
import { CONSTANTS } from '../utils/constants';
import { logger } from '../utils/logger';

export const signup = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email, password, name } = req.body;

    // Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      throw new ConflictError('Email already registered');
    }

    // Create user
    const user = await User.create({
      email,
      password,
      name
    });

    // Create default organization
    const organization = await Organization.create({
      name: `${name}'s Organization`,
      owner: user._id,
      members: [{
        userId: user._id,
        role: 'admin',
        joinedAt: new Date()
      }]
    });

    // Update user with organization
    user.organizations.push(organization._id);
    await user.save();

    // Generate tokens
    const accessToken = user.generateAccessToken();
    const refreshToken = user.generateRefreshToken();

    logger.info(`New user registered: ${email}`);

    res.status(201).json({
      success: true,
      message: CONSTANTS.RESPONSE_MESSAGES.CREATED,
      data: {
        user: {
          id: user._id,
          email: user.email,
          name: user.name,
          profileImage: user.profileImage
        },
        organization: {
          id: organization._id,
          name: organization.name,
          role: 'admin'
        },
        accessToken,
        refreshToken
      }
    });
  } catch (error) {
    next(error);
  }
};

export const login = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email, password } = req.body;

    // Find user with password
    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      throw new AuthenticationError(CONSTANTS.RESPONSE_MESSAGES.INVALID_CREDENTIALS);
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      throw new AuthenticationError(CONSTANTS.RESPONSE_MESSAGES.INVALID_CREDENTIALS);
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Get user's organizations
    const organizations = await Organization.find({
      _id: { $in: user.organizations }
    });

    // Generate tokens with first organization
    const accessToken = user.generateAccessToken();
    const refreshToken = user.generateRefreshToken();

    logger.info(`User logged in: ${email}`);

    res.json({
      success: true,
      message: CONSTANTS.RESPONSE_MESSAGES.SUCCESS,
      data: {
        user: {
          id: user._id,
          email: user.email,
          name: user.name,
          profileImage: user.profileImage
        },
        organizations: organizations.map(org => ({
          id: org._id,
          name: org.name,
          role: org.getMemberRole(user._id.toString())
        })),
        accessToken,
        refreshToken
      }
    });
  } catch (error) {
    next(error);
  }
};

export const logout = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // In a production app, you might want to blacklist the token
    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    next(error);
  }
};

export const refreshToken = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      throw new AuthenticationError('Refresh token required');
    }

    // Verify refresh token
    const decoded = jwt.verify(
      refreshToken,
      process.env.JWT_REFRESH_SECRET!
    ) as { userId: string };

    // Get user
    const user = await User.findById(decoded.userId);
    if (!user) {
      throw new AuthenticationError('Invalid refresh token');
    }

    // Generate new tokens
    const newAccessToken = user.generateAccessToken();
    const newRefreshToken = user.generateRefreshToken();

    res.json({
      success: true,
      data: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken
      }
    });
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      next(new AuthenticationError('Invalid refresh token'));
    } else {
      next(error);
    }
  }
};

export const forgotPassword = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      // Don't reveal if user exists
      res.json({
        success: true,
        message: 'Password reset instructions sent to email'
      });
      return;
    }

    // Generate reset token
    const resetToken = jwt.sign(
      { userId: user._id, purpose: 'password-reset' },
      process.env.JWT_SECRET!,
      { expiresIn: '1h' }
    );

    // In production, send email with reset link
    // For now, just return the token
    logger.info(`Password reset requested for: ${email}`);

    res.json({
      success: true,
      message: 'Password reset instructions sent to email',
      ...(process.env.NODE_ENV === 'development' && { resetToken })
    });
  } catch (error) {
    next(error);
  }
};

export const resetPassword = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      throw new ValidationError('Token and new password required');
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    if (decoded.purpose !== 'password-reset') {
      throw new AuthenticationError('Invalid reset token');
    }

    // Update password
    const user = await User.findById(decoded.userId);
    if (!user) {
      throw new NotFoundError('User');
    }

    user.password = newPassword;
    await user.save();

    logger.info(`Password reset successful for user: ${user.email}`);

    res.json({
      success: true,
      message: 'Password reset successful'
    });
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      next(new AuthenticationError('Invalid or expired reset token'));
    } else {
      next(error);
    }
  }
};

export const getCurrentUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const user = await User.findById(req.user!.userId);
    if (!user) {
      throw new NotFoundError('User');
    }

    const organizations = await Organization.find({
      _id: { $in: user.organizations }
    });

    res.json({
      success: true,
      data: {
        user: {
          id: user._id,
          email: user.email,
          name: user.name,
          profileImage: user.profileImage,
          createdAt: user.createdAt,
          lastLogin: user.lastLogin
        },
        organizations: organizations.map(org => ({
          id: org._id,
          name: org.name,
          role: org.getMemberRole(user._id.toString()),
          memberCount: org.members.length
        }))
      }
    });
  } catch (error) {
    next(error);
  }
};

export const updateProfile = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { name, profileImage } = req.body;
    
    const user = await User.findById(req.user!.userId);
    if (!user) {
      throw new NotFoundError('User');
    }

    if (name) user.name = name;
    if (profileImage) user.profileImage = profileImage;
    
    await user.save();

    res.json({
      success: true,
      message: CONSTANTS.RESPONSE_MESSAGES.UPDATED,
      data: {
        user: {
          id: user._id,
          email: user.email,
          name: user.name,
          profileImage: user.profileImage
        }
      }
    });
  } catch (error) {
    next(error);
  }
};