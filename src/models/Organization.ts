import mongoose, { Schema } from 'mongoose';
import { IOrganization } from '../types';

const organizationSchema = new Schema<IOrganization>({
  name: {
    type: String,
    required: [true, 'Organization name is required'],
    trim: true,
    maxlength: [100, 'Organization name cannot exceed 100 characters']
  },
  owner: {
    type: 'ObjectId' as any,
    ref: 'User',
    required: true
  },
  members: [{
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    role: {
      type: String,
      enum: ['admin', 'editor', 'viewer'],
      default: 'viewer'
    },
    joinedAt: {
      type: Date,
      default: Date.now
    }
  }],
  settings: {
    allowedDomains: [String],
    maxProjects: {
      type: Number,
      default: 10
    },
    features: [String]
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update timestamp on save
organizationSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Add owner as admin member on creation
organizationSchema.pre('save', async function(next) {
  if (this.isNew) {
    const ownerExists = this.members.some(member => 
      member.userId.toString() === this.owner.toString()
    );
    
    if (!ownerExists) {
      this.members.push({
        userId: this.owner as any,
        role: 'admin',
        joinedAt: new Date()
      });
    }
  }
  next();
});

// Instance methods
organizationSchema.methods.isMember = function(userId: string): boolean {
  return this.members.some(member => member.userId.toString() === userId);
};

organizationSchema.methods.getMemberRole = function(userId: string): string | null {
  const member = this.members.find(m => m.userId.toString() === userId);
  return member ? member.role : null;
};

organizationSchema.methods.hasPermission = function(userId: string, requiredRole: string): boolean {
  const member = this.members.find(m => m.userId.toString() === userId);
  if (!member) return false;
  
  const roleHierarchy = { viewer: 1, editor: 2, admin: 3 };
  const userLevel = roleHierarchy[member.role as keyof typeof roleHierarchy] || 0;
  const requiredLevel = roleHierarchy[requiredRole as keyof typeof roleHierarchy] || 0;
  
  return userLevel >= requiredLevel;
};

// Indexes
organizationSchema.index({ owner: 1 });
organizationSchema.index({ 'members.userId': 1 });
organizationSchema.index({ createdAt: -1 });

export const Organization = mongoose.model<IOrganization>('Organization', organizationSchema);
