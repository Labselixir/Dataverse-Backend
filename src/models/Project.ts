import mongoose, { Schema } from 'mongoose';
import CryptoJS from 'crypto-js';
import { IProject } from '../types';

const projectSchema = new Schema<IProject>({
  name: {
    type: String,
    required: [true, 'Project name is required'],
    trim: true,
    maxlength: [50, 'Project name cannot exceed 50 characters']
  },
  organizationId: {
    type: Schema.Types.ObjectId,
    ref: 'Organization',
    required: true
  },
  mongoUri: {
    type: String,
    required: [true, 'MongoDB URI is required']
  },
  encryptedApiKey: {
    type: String,
    default: null
  },
  databaseName: {
    type: String,
    required: true
  },
  schemaCache: {
    databaseName: String,
    collections: [{
      name: String,
      fields: [Schema.Types.Mixed],
      sampleDocument: Schema.Types.Mixed,
      documentCount: Number,
      indexes: [Schema.Types.Mixed]
    }],
    relationships: [{
      from: String,
      to: String,
      type: {
        type: String,
        enum: ['one-to-one', 'one-to-many', 'many-to-many']
      },
      field: String,
      direction: String
    }],
    stats: {
      totalCollections: Number,
      totalDocuments: Number,
      averageFieldCount: Number
    },
    lastSynced: Date
  },
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  lastAccessed: {
    type: Date,
    default: Date.now
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

// Encrypt MongoDB URI before saving
projectSchema.pre('save', function(next) {
  if (this.isModified('mongoUri') && !this.mongoUri.startsWith('U2FsdGVkX1')) {
    // Only encrypt if not already encrypted (check for CryptoJS format)
    try {
      const encrypted = CryptoJS.AES.encrypt(
        this.mongoUri, 
        process.env.ENCRYPTION_KEY!
      ).toString();
      this.mongoUri = encrypted;
    } catch (error) {
      // If encryption fails, keep original
      console.error('Encryption error:', error);
    }
  }
  
  if (this.isModified('encryptedApiKey') && this.encryptedApiKey && !this.encryptedApiKey.startsWith('U2FsdGVkX1')) {
    try {
      const encrypted = CryptoJS.AES.encrypt(
        this.encryptedApiKey,
        process.env.ENCRYPTION_KEY!
      ).toString();
      this.encryptedApiKey = encrypted;
    } catch (error) {
      console.error('Encryption error:', error);
    }
  }
  
  this.updatedAt = new Date();
  next();
});

// Decrypt MongoDB URI when retrieving
projectSchema.methods.getDecryptedUri = function(): string {
  try {
    // Check if it's encrypted (CryptoJS format starts with U2FsdGVkX1)
    if (!this.mongoUri || !this.mongoUri.startsWith('U2FsdGVkX1')) {
      return this.mongoUri; // Return as-is if not encrypted
    }
    
    const decrypted = CryptoJS.AES.decrypt(
      this.mongoUri,
      process.env.ENCRYPTION_KEY!
    ).toString(CryptoJS.enc.Utf8);
    
    if (!decrypted) {
      throw new Error('Decryption resulted in empty string');
    }
    return decrypted;
  } catch (error) {
    throw new Error(`Failed to decrypt URI: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

// Decrypt API Key when retrieving
projectSchema.methods.getDecryptedApiKey = function(): string | null {
  if (!this.encryptedApiKey) return null;
  
  try {
    // Check if it's encrypted
    if (!this.encryptedApiKey.startsWith('U2FsdGVkX1')) {
      return this.encryptedApiKey; // Return as-is if not encrypted
    }
    
    const decrypted = CryptoJS.AES.decrypt(
      this.encryptedApiKey,
      process.env.ENCRYPTION_KEY!
    ).toString(CryptoJS.enc.Utf8);
    return decrypted;
  } catch (error) {
    console.error('Decryption error:', error);
    return null;
  }
};

// Update last accessed
projectSchema.methods.updateLastAccessed = async function(): Promise<void> {
  this.lastAccessed = new Date();
  await this.save();
};

// Update schema cache atomically
projectSchema.methods.updateSchemaCache = async function(schema: any): Promise<void> {
  this.schemaCache = {
    databaseName: this.databaseName,
    collections: schema.collections,
    relationships: schema.relationships,
    lastSynced: new Date()
  };
  await this.save();
};

// Check if schema needs refresh (older than 30 minutes)
projectSchema.methods.needsSchemaRefresh = function(): boolean {
  if (!this.schemaCache?.lastSynced) return true;
  
  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
  return this.schemaCache.lastSynced < thirtyMinutesAgo;
};

// Virtual for connection status
projectSchema.virtual('connectionStatus').get(function() {
  if (!this.schemaCache?.lastSynced) return 'disconnected';
  
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  return this.schemaCache.lastSynced > fiveMinutesAgo ? 'connected' : 'idle';
});

// Indexes
projectSchema.index({ organizationId: 1, createdAt: -1 });
projectSchema.index({ createdBy: 1 });
projectSchema.index({ name: 'text' });

export const Project = mongoose.model<IProject>('Project', projectSchema);