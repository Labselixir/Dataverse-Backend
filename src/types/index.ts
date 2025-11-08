import { Request } from 'express';
import { Document } from 'mongoose';

export interface IUser extends Document {
  email: string;
  password: string;
  name: string;
  profileImage?: string;
  organizations: string[];
  createdAt: Date;
  lastLogin: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
  generateAccessToken(): string;
  generateRefreshToken(): string;
}

export interface IOrganization extends Document {
  name: string;
  owner: string;
  members: Array<{
    userId: string;
    role: 'admin' | 'editor' | 'viewer';
    joinedAt: Date;
  }>;
  settings: {
    allowedDomains?: string[];
    maxProjects?: number;
    features?: string[];
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface IProject extends Document {
  name: string;
  organizationId: string;
  mongoUri: string;
  encryptedApiKey?: string;
  databaseName: string;
  schemaCache?: {
    databaseName?: string;
    collections: Array<{
      name: string;
      fields: Array<{
        name: string;
        type: string;
        required: boolean;
        isArray: boolean;
      }>;
      sampleDocument?: any;
      documentCount: number;
    }>;
    relationships: Array<{
      from: string;
      to: string;
      type: 'one-to-one' | 'one-to-many' | 'many-to-many';
      field: string;
    }>;
    lastSynced: Date;
  };
  createdBy: string;
  lastAccessed: Date;
  createdAt: Date;
  updatedAt: Date;
  getDecryptedUri(): string;
  getDecryptedApiKey(): string | null;
  updateLastAccessed(): Promise<void>;
  updateSchemaCache(schema: any): Promise<void>;
  needsSchemaRefresh(): boolean;
}

export interface IChatHistory extends Document {
  projectId: string;
  userId: string;
  message: string;
  aiResponse: string;
  metadata: {
    tokens?: number;
    model?: string;
    queryType?: string;
    collections?: string[];
    executionTime?: number;
  };
  createdAt: Date;
}

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    email: string;
    organizationId?: string;
  };
}

export interface TokenPayload {
  userId: string;
  email: string;
  organizationId?: string;
}

export interface PaginationQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  order?: 'asc' | 'desc';
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  metadata?: {
    page?: number;
    limit?: number;
    total?: number;
    hasMore?: boolean;
  };
}

export interface SchemaExtraction {
  collections: CollectionSchema[];
  relationships: Relationship[];
  stats: {
    totalCollections: number;
    totalDocuments: number;
    averageFieldCount: number;
  };
}

export interface CollectionSchema {
  name: string;
  fields: FieldSchema[];
  indexes: any[];
  documentCount: number;
  sampleDocument?: any;
}

export interface FieldSchema {
  name: string;
  type: string;
  required: boolean;
  isArray: boolean;
  isNested: boolean;
  enumValues?: any[];
  nestedSchema?: FieldSchema[];
  sampleValues?: any[];
}

export interface Relationship {
  from: string;
  to: string;
  field: string;
  type: 'one-to-one' | 'one-to-many' | 'many-to-many';
  direction: 'forward' | 'reverse' | 'bidirectional';
}

export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400);
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication failed') {
    super(message, 401);
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = 'Access denied') {
    super(message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'Resource not found') {
    super(message, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409);
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = 'Too many requests') {
    super(message, 429);
  }
}