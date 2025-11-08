import mongoose, { Schema } from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { IUser } from '../types';
import { CONSTANTS } from '../utils/constants';

const userSchema = new Schema<IUser>({
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please enter a valid email']
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [8, 'Password must be at least 8 characters'],
    select: false
  },
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    maxlength: [100, 'Name cannot exceed 100 characters']
  },
  profileImage: {
    type: String,
    default: null
  },
  organizations: [{
    type: Schema.Types.ObjectId,
    ref: 'Organization'
  }],
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastLogin: {
    type: Date,
    default: Date.now
  }
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) {
    return next();
  }
  
  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error as Error);
  }
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword: string): Promise<boolean> {
  try {
    return await bcrypt.compare(candidatePassword, this.password);
  } catch (error) {
    return false;
  }
};

// Generate access token
userSchema.methods.generateAccessToken = function(): string {
  return jwt.sign(
    {
      userId: this._id,
      email: this.email,
      organizationId: this.organizations[0] || null
    },
    process.env.JWT_SECRET! as string,
    { expiresIn: CONSTANTS.JWT.ACCESS_TOKEN_EXPIRE } as any
  );
};

// Generate refresh token
userSchema.methods.generateRefreshToken = function(): string {
  return jwt.sign(
    { userId: this._id },
    process.env.JWT_REFRESH_SECRET! as string,
    { expiresIn: CONSTANTS.JWT.REFRESH_TOKEN_EXPIRE } as any
  );
};

// Update last login
userSchema.methods.updateLastLogin = async function(): Promise<void> {
  this.lastLogin = new Date();
  await this.save();
};

// Only one index definition - removed duplicate
userSchema.index({ email: 1 });

export const User = mongoose.model<IUser>('User', userSchema);
