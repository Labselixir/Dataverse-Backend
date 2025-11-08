import mongoose from 'mongoose';
import { logger } from '../utils/logger';

export const databaseConfig = {
  options: {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  },

  events: {
    connected: () => {
      logger.info('MongoDB connected successfully');
    },
    error: (error: Error) => {
      logger.error('MongoDB connection error:', error);
    },
    disconnected: () => {
      logger.warn('MongoDB disconnected');
    },
    reconnected: () => {
      logger.info('MongoDB reconnected');
    },
    close: () => {
      logger.info('MongoDB connection closed');
    }
  },

  setupEventListeners: () => {
    mongoose.connection.on('connected', databaseConfig.events.connected);
    mongoose.connection.on('error', databaseConfig.events.error);
    mongoose.connection.on('disconnected', databaseConfig.events.disconnected);
    mongoose.connection.on('reconnected', databaseConfig.events.reconnected);
    mongoose.connection.on('close', databaseConfig.events.close);
  }
};