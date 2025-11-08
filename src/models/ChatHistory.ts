import mongoose, { Schema } from 'mongoose';
import { IChatHistory } from '../types';

const chatHistorySchema = new Schema<IChatHistory>({
  projectId: {
    type: 'ObjectId' as any,
    ref: 'Project',
    required: true
  },
  userId: {
    type: 'ObjectId' as any,
    ref: 'User',
    required: true
  },
  message: {
    type: String,
    required: [true, 'Message is required'],
    maxlength: [1000, 'Message cannot exceed 1000 characters']
  },
  aiResponse: {
    type: String,
    required: true
  },
  metadata: {
    tokens: Number,
    model: {
      type: String,
      default: 'mixtral-8x7b-32768'
    },
    queryType: String,
    collections: [String],
    executionTime: Number
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 7776000 // 90 days in seconds
  }
});

// Indexes
chatHistorySchema.index({ projectId: 1, createdAt: -1 });
chatHistorySchema.index({ userId: 1, createdAt: -1 });
chatHistorySchema.index({ createdAt: 1 }, { expireAfterSeconds: 7776000 });

export const ChatHistory = mongoose.model<IChatHistory>('ChatHistory', chatHistorySchema);
