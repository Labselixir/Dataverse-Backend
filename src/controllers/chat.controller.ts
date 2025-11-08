import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { Project } from '../models/Project';
import { ChatHistory } from '../models/ChatHistory';
import { AIService } from '../services/ai.service';
import { MongoDBService } from '../services/mongodb.service';
import { NotFoundError, ValidationError } from '../utils/errors';
import { logger } from '../utils/logger';
import { CONSTANTS } from '../utils/constants';

export const sendMessage = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { projectId, message } = req.body;
    const { userId, organizationId } = req.user!;

    // Get project
    const project = await Project.findOne({
      _id: projectId,
      organizationId
    });

    if (!project) {
      throw new NotFoundError('Project');
    }

    // Get chat history for context
    const recentHistory = await ChatHistory.find({
      projectId,
      userId
    })
      .sort({ createdAt: -1 })
      .limit(5)
      .select('message aiResponse');

    // Initialize AI service
    const apiKey = project.getDecryptedApiKey() || process.env.GROQ_API_KEY;
    const aiService = new AIService(apiKey!);

    // Get decrypted MongoDB URI for query execution
    const decryptedUri = project.getDecryptedUri();

    // Generate response
    const startTime = Date.now();
    const response = await aiService.generateResponse(
      message,
      project.schemaCache,
      recentHistory.reverse(),
      decryptedUri
    );
    const executionTime = Date.now() - startTime;

    // Save to history
    await ChatHistory.create({
      projectId,
      userId,
      message,
      aiResponse: response.content,
      metadata: {
        model: response.model,
        tokens: response.tokens,
        executionTime,
        queryType: response.queryType,
        collections: response.collections
      }
    });

    logger.info(`Chat message processed for project ${projectId}`);

    res.json({
      success: true,
      data: {
        response: response.content,
        suggestions: response.suggestions,
        metadata: {
          executionTime,
          tokens: response.tokens,
          queryType: response.queryType
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

export const streamMessage = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { projectId, message } = req.body;
    const { userId, organizationId } = req.user!;

    // Get project
    const project = await Project.findOne({
      _id: projectId,
      organizationId
    });

    if (!project) {
      throw new NotFoundError('Project');
    }

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // Get chat history for context
    const recentHistory = await ChatHistory.find({
      projectId,
      userId
    })
      .sort({ createdAt: -1 })
      .limit(5)
      .select('message aiResponse');

    // Initialize AI service
    const apiKey = project.getDecryptedApiKey() || process.env.GROQ_API_KEY;
    const aiService = new AIService(apiKey!);

    let fullResponse = '';
    let metadata: any = {};

    // Stream response
    await aiService.streamResponse(
      message,
      project.schemaCache,
      recentHistory.reverse(),
      (chunk: string) => {
        fullResponse += chunk;
        res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
      },
      (finalMetadata: any) => {
        metadata = finalMetadata;
      }
    );

    // Save to history
    await ChatHistory.create({
      projectId,
      userId,
      message,
      aiResponse: fullResponse,
      metadata
    });

    // Send final event
    res.write(`data: ${JSON.stringify({ done: true, metadata })}\n\n`);
    res.end();

    logger.info(`Streamed chat message for project ${projectId}`);
  } catch (error) {
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
    logger.error('Stream error:', error);
  }
};

export const getChatHistory = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { projectId } = req.params;
    const { userId, organizationId } = req.user!;
    const { page = 1, limit = 20 } = req.query;

    // Verify project access
    const project = await Project.findOne({
      _id: projectId,
      organizationId
    });

    if (!project) {
      throw new NotFoundError('Project');
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [messages, total] = await Promise.all([
      ChatHistory.find({ projectId, userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      ChatHistory.countDocuments({ projectId, userId })
    ]);

    res.json({
      success: true,
      data: {
        messages: messages.reverse(),
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          hasMore: skip + messages.length < total
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

export const clearChatHistory = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { projectId } = req.params;
    const { userId, organizationId } = req.user!;

    // Verify project access
    const project = await Project.findOne({
      _id: projectId,
      organizationId
    });

    if (!project) {
      throw new NotFoundError('Project');
    }

    await ChatHistory.deleteMany({ projectId, userId });

    logger.info(`Chat history cleared for project ${projectId}`);

    res.json({
      success: true,
      message: 'Chat history cleared successfully'
    });
  } catch (error) {
    next(error);
  }
};

export const getSuggestions = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { projectId, context } = req.body;
    const { organizationId } = req.user!;

    const project = await Project.findOne({
      _id: projectId,
      organizationId
    });

    if (!project) {
      throw new NotFoundError('Project');
    }

    const apiKey = project.getDecryptedApiKey() || process.env.GROQ_API_KEY;
    const aiService = new AIService(apiKey!);

    const suggestions = await aiService.generateSuggestions(
      context,
      project.schemaCache
    );

    res.json({
      success: true,
      data: { suggestions }
    });
  } catch (error) {
    next(error);
  }
};

export const executeQuery = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { projectId, query, queryType } = req.body;
    const { organizationId } = req.user!;

    const project = await Project.findOne({
      _id: projectId,
      organizationId
    });

    if (!project) {
      throw new NotFoundError('Project');
    }

    const decryptedUri = project.getDecryptedUri();
    const mongoService = new MongoDBService(decryptedUri);

    await mongoService.connect();

    let result: any;
    const startTime = Date.now();

    switch (queryType) {
      case 'find':
        result = await mongoService.executeReadQuery(
          project.databaseName,
          query.collection,
          query.filter || {},
          query.options || {}
        );
        break;

      case 'aggregate':
        result = await mongoService.executeAggregation(
          project.databaseName,
          query.collection,
          query.pipeline || []
        );
        break;

      case 'count':
        result = await mongoService.getCollectionCount(
          project.databaseName,
          query.collection
        );
        break;

      default:
        throw new ValidationError('Invalid query type');
    }

    await mongoService.disconnect();

    const executionTime = Date.now() - startTime;

    res.json({
      success: true,
      data: {
        result,
        executionTime,
        queryType,
        collection: query.collection
      }
    });
  } catch (error) {
    next(error);
  }
};