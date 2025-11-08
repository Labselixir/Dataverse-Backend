import { Response, NextFunction } from 'express';
import { Organization } from '../models/Organization';
import { User } from '../models/User';
import { Project } from '../models/Project';
import { AuthRequest } from '../types';
import { NotFoundError, ConflictError, AuthorizationError, ValidationError } from '../utils/errors';
import { CONSTANTS } from '../utils/constants';
import { logger } from '../utils/logger';

export const createOrganization = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { name } = req.body;
    const { userId } = req.user!;

    const organization = await Organization.create({
      name,
      owner: userId,
      members: [{
        userId,
        role: 'admin',
        joinedAt: new Date()
      }]
    });

    // Update user's organizations
    await User.findByIdAndUpdate(userId, {
      $push: { organizations: organization._id }
    });

    logger.info(`Organization created: ${name} by user ${userId}`);

    res.status(201).json({
      success: true,
      message: CONSTANTS.RESPONSE_MESSAGES.CREATED,
      data: {
        organization: {
          id: organization._id,
          name: organization.name,
          owner: organization.owner,
          memberCount: 1,
          createdAt: organization.createdAt
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getOrganization = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { organizationId } = req.user!;

    const organization = await Organization.findById(organizationId)
      .populate('members.userId', 'name email profileImage')
      .populate('owner', 'name email');

    if (!organization) {
      throw new NotFoundError('Organization');
    }

    const projectCount = await Project.countDocuments({ organizationId });

    res.json({
      success: true,
      data: {
        organization: {
          id: organization._id,
          name: organization.name,
          owner: organization.owner,
          members: organization.members,
          settings: organization.settings,
          projectCount,
          createdAt: organization.createdAt
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

export const updateOrganization = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { organizationId } = req.user!;
    const { name, settings } = req.body;

    const organization = await Organization.findById(organizationId);
    if (!organization) {
      throw new NotFoundError('Organization');
    }

    if (name) organization.name = name;
    if (settings) {
      organization.settings = { ...organization.settings, ...settings };
    }

    await organization.save();

    logger.info(`Organization updated: ${organization.name}`);

    res.json({
      success: true,
      message: CONSTANTS.RESPONSE_MESSAGES.UPDATED,
      data: {
        organization: {
          id: organization._id,
          name: organization.name,
          settings: organization.settings
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

export const inviteMember = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { organizationId } = req.user!;
    const { email, role } = req.body;

    const organization = await Organization.findById(organizationId);
    if (!organization) {
      throw new NotFoundError('Organization');
    }

    // Find user by email
    const invitedUser = await User.findOne({ email });
    if (!invitedUser) {
      throw new NotFoundError('User with this email');
    }

    // Check if already a member
    if (organization.isMember(invitedUser._id.toString())) {
      throw new ConflictError('User is already a member');
    }

    // Add member
    organization.members.push({
      userId: invitedUser._id as any,
      role,
      joinedAt: new Date()
    });
    await organization.save();

    // Update user's organizations
    invitedUser.organizations.push(organization._id as any);
    await invitedUser.save();

    logger.info(`Member invited to organization: ${email} as ${role}`);

    res.json({
      success: true,
      message: 'Member invited successfully',
      data: {
        member: {
          userId: invitedUser._id,
          email: invitedUser.email,
          name: invitedUser.name,
          role,
          joinedAt: new Date()
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

export const removeMember = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { organizationId, userId: currentUserId } = req.user!;
    const { userId } = req.params;

    if (userId === currentUserId) {
      throw new ValidationError('Cannot remove yourself. Use leave organization instead.');
    }

    const organization = await Organization.findById(organizationId);
    if (!organization) {
      throw new NotFoundError('Organization');
    }

    // Cannot remove owner
    if (userId === organization.owner.toString()) {
      throw new AuthorizationError('Cannot remove organization owner');
    }

    // Remove member
    organization.members = organization.members.filter(
      member => member.userId.toString() !== userId
    );
    await organization.save();

    // Update user's organizations
    await User.findByIdAndUpdate(userId, {
      $pull: { organizations: organizationId }
    });

    logger.info(`Member removed from organization: ${userId}`);

    res.json({
      success: true,
      message: 'Member removed successfully'
    });
  } catch (error) {
    next(error);
  }
};

export const updateMemberRole = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { organizationId, userId: currentUserId } = req.user!;
    const { userId } = req.params;
    const { role } = req.body;

    if (userId === currentUserId) {
      throw new ValidationError('Cannot change your own role');
    }

    const organization = await Organization.findById(organizationId);
    if (!organization) {
      throw new NotFoundError('Organization');
    }

    // Cannot change owner's role
    if (userId === organization.owner.toString()) {
      throw new AuthorizationError('Cannot change organization owner role');
    }

    const memberIndex = organization.members.findIndex(
      member => member.userId.toString() === userId
    );

    if (memberIndex === -1) {
      throw new NotFoundError('Member');
    }

    organization.members[memberIndex].role = role;
    await organization.save();

    logger.info(`Member role updated: ${userId} to ${role}`);

    res.json({
      success: true,
      message: 'Member role updated successfully'
    });
  } catch (error) {
    next(error);
  }
};

export const leaveOrganization = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { organizationId, userId } = req.user!;

    const organization = await Organization.findById(organizationId);
    if (!organization) {
      throw new NotFoundError('Organization');
    }

    // Owner cannot leave
    if (userId === organization.owner.toString()) {
      throw new ValidationError('Organization owner cannot leave. Transfer ownership first.');
    }

    // Remove from organization
    organization.members = organization.members.filter(
      member => member.userId.toString() !== userId
    );
    await organization.save();

    // Update user
    await User.findByIdAndUpdate(userId, {
      $pull: { organizations: organizationId }
    });

    logger.info(`User left organization: ${userId} from ${organizationId}`);

    res.json({
      success: true,
      message: 'Successfully left organization'
    });
  } catch (error) {
    next(error);
  }
};

export const getMembers = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { organizationId } = req.user!;

    const organization = await Organization.findById(organizationId)
      .populate('members.userId', 'name email profileImage lastLogin');

    if (!organization) {
      throw new NotFoundError('Organization');
    }

    const members = organization.members.map(member => ({
      id: member.userId,
      role: member.role,
      joinedAt: member.joinedAt
    }));

    res.json({
      success: true,
      data: {
        members,
        total: members.length
      }
    });
  } catch (error) {
    next(error);
  }
};

export const switchOrganization = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { userId } = req.user!;
    const { id } = req.params;

    const organization = await Organization.findById(id);
    if (!organization) {
      throw new NotFoundError('Organization');
    }

    if (!organization.isMember(userId)) {
      throw new AuthorizationError('Not a member of this organization');
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new NotFoundError('User');
    }

    // Generate new token with updated organization
    const accessToken = user.generateAccessToken();
    const refreshToken = user.generateRefreshToken();

    logger.info(`User switched organization: ${userId} to ${id}`);

    res.json({
      success: true,
      message: 'Organization switched successfully',
      data: {
        organization: {
          id: organization._id,
          name: organization.name,
          role: organization.getMemberRole(userId)
        },
        accessToken,
        refreshToken
      }
    });
  } catch (error) {
    next(error);
  }
};