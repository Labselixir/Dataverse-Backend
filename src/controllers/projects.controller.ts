import { Response, NextFunction } from 'express';
import { Project } from '../models/Project';
import { AuthRequest, PaginationQuery } from '../types';
import { NotFoundError, ConflictError, ValidationError } from '../utils/errors';
import { MongoDBService, DatabaseInfo } from '../services/mongodb.service';
import { SchemaService } from '../services/schema.service';
import { CacheService } from '../services/cache.service';
import { CONSTANTS } from '../utils/constants';
import { createStructuredLogger } from '../utils/logger';

const log = createStructuredLogger('ProjectsController');
const cacheService = new CacheService();

export const createProject = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { name, mongoUri, apiKey } = req.body;
    const { userId, organizationId } = req.user!;

    // Validate MongoDB connection
    const mongoService = new MongoDBService(mongoUri);
    const connectionInfo = await mongoService.validateConnection();

    if (!connectionInfo.isValid) {
      throw new ValidationError(connectionInfo.error || 'Invalid MongoDB connection');
    }

    // Check for duplicate project name in organization
    const existingProject = await Project.findOne({
      organizationId,
      name: { $regex: new RegExp(`^${name}$`, 'i') }
    });

    if (existingProject) {
      throw new ConflictError('Project name already exists in this organization');
    }

    // Create project
    const project = await Project.create({
      name,
      organizationId,
      mongoUri,
      encryptedApiKey: apiKey || null,
      databaseName: connectionInfo.databaseName!,
      createdBy: userId
    });

    // Extract schema synchronously on creation (blocking)
    const schemaService = new SchemaService();
    try {
      const schema = await schemaService.extractAndCacheSchema(project._id.toString(), mongoUri, true);
      if (schema) {
        log.success(`Schema extracted successfully for project ${name}`);
      } else {
        log.warn(`Schema extraction returned null for project ${name}`);
      }
    } catch (error) {
      log.warn(`Failed to extract schema during project creation for ${name}:`, error);
      // Continue anyway - project is created, schema extraction can be retried
    }

    log.success(`Project created successfully: ${name} by user ${userId}`);

    res.status(201).json({
      success: true,
      message: CONSTANTS.RESPONSE_MESSAGES.CREATED,
      data: {
        project: {
          id: project._id,
          name: project.name,
          databaseName: project.databaseName,
          connectionStatus: project.connectionStatus,
          schema: project.schemaCache,
          createdAt: project.createdAt,
          lastAccessed: project.lastAccessed
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getProjects = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { organizationId } = req.user!;
    const { page = 1, limit = 10, sortBy = 'createdAt', order = 'desc' } = req.query as unknown as PaginationQuery;

    const skip = (page - 1) * limit;
    const sortOrder = order === 'asc' ? 1 : -1;

    const [projects, total] = await Promise.all([
      Project.find({ organizationId })
        .sort({ [sortBy!]: sortOrder })
        .skip(skip)
        .limit(limit)
        .select('-mongoUri -encryptedApiKey'),
      Project.countDocuments({ organizationId })
    ]);

    const projectsWithStatus = projects.map(project => ({
      id: project._id,
      name: project.name,
      databaseName: project.databaseName,
      connectionStatus: project.connectionStatus,
      lastAccessed: project.lastAccessed,
      createdAt: project.createdAt,
      hasSchema: !!project.schemaCache?.collections?.length,
      collectionsCount: project.schemaCache?.collections?.length || 0
    }));

    res.json({
      success: true,
      data: {
        projects: projectsWithStatus,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasMore: page * limit < total
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getProjectById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const { organizationId } = req.user!;

    log.step(1, 3, 'Fetching project by ID');
    log.table({ projectId: id, organizationId });

    const project = await Project.findOne({
      _id: id,
      organizationId
    }).select('-mongoUri -encryptedApiKey');

    if (!project) {
      log.error('Project not found', { projectId: id, organizationId });
      throw new NotFoundError('Project not found');
    }

    log.success('Project found', { projectName: project.name });

    log.step(2, 3, 'Updating last accessed timestamp');
    // Update last accessed (non-blocking)
    project.updateLastAccessed().catch(error => {
      log.warn('Failed to update last accessed:', error);
    });

    log.step(3, 3, 'Checking if schema needs refresh');
    // Check if schema needs refresh (non-blocking)
    if (project.needsSchemaRefresh()) {
      log.info('Schema refresh needed, triggering background extraction');
      const schemaService = new SchemaService();
      try {
        // Fetch fresh project document to ensure mongoUri is available
        const freshProject = await Project.findById(project._id);
        if (freshProject) {
          const decryptedUri = freshProject.getDecryptedUri();
          if (decryptedUri) {
            schemaService.extractAndCacheSchema(project._id.toString(), decryptedUri, true).catch(error => {
              log.warn('Failed to refresh schema:', error);
            });
          } else {
            log.warn('Failed to decrypt URI - URI is empty');
          }
        }
      } catch (error) {
        log.warn('Failed to decrypt URI for schema refresh:', error);
      }
    } else {
      log.debug('Schema is fresh, no refresh needed');
    }

    log.success('Project retrieved successfully');

    // Log schema info for debugging
    if (project.schemaCache?.collections) {
      log.debug('Schema cache found', {
        collections: project.schemaCache.collections.length,
        relationships: project.schemaCache.relationships?.length || 0,
        lastSynced: project.schemaCache.lastSynced
      });
    } else {
      log.debug('No schema cache found for project');
    }

    res.json({
      success: true,
      data: {
        project: {
          id: project._id,
          name: project.name,
          databaseName: project.databaseName,
          connectionStatus: project.connectionStatus,
          schema: project.schemaCache,
          schemaCache: project.schemaCache,
          lastAccessed: project.lastAccessed,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
          createdBy: project.createdBy
        }
      }
    });
  } catch (error) {
    log.error('Failed to get project by ID', error);
    next(error);
  }
};

export const updateProject = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, apiKey } = req.body;
    const { organizationId } = req.user!;

    const project = await Project.findOne({
      _id: id,
      organizationId
    });

    if (!project) {
      throw new NotFoundError('Project');
    }

    // Check for duplicate name if changing
    if (name && name !== project.name) {
      const duplicate = await Project.findOne({
        organizationId,
        name: { $regex: new RegExp(`^${name}$`, 'i') },
        _id: { $ne: id }
      });

      if (duplicate) {
        throw new ConflictError('Project name already exists');
      }

      project.name = name;
    }

    if (apiKey !== undefined) {
      project.encryptedApiKey = apiKey;
    }

    await project.save();

    log.info(`Project updated: ${project.name}`);

    res.json({
      success: true,
      message: CONSTANTS.RESPONSE_MESSAGES.UPDATED,
      data: {
        project: {
          id: project._id,
          name: project.name,
          databaseName: project.databaseName,
          updatedAt: project.updatedAt
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

export const deleteProject = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const { organizationId } = req.user!;

    const project = await Project.findOneAndDelete({
      _id: id,
      organizationId
    });

    if (!project) {
      throw new NotFoundError('Project');
    }

    log.info(`Project deleted: ${project.name}`);

    res.json({
      success: true,
      message: CONSTANTS.RESPONSE_MESSAGES.DELETED
    });
  } catch (error) {
    next(error);
  }
};

export const duplicateProject = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const { userId, organizationId } = req.user!;

    const originalProject = await Project.findOne({
      _id: id,
      organizationId
    });

    if (!originalProject) {
      throw new NotFoundError('Project');
    }

    // Generate unique name
    let copyName = `${originalProject.name} (Copy)`;
    let counter = 1;
    while (await Project.exists({ organizationId, name: copyName })) {
      copyName = `${originalProject.name} (Copy ${++counter})`;
    }

    // Create duplicate
    const duplicatedProject = await Project.create({
      name: copyName,
      organizationId,
      mongoUri: originalProject.mongoUri, // Already encrypted
      encryptedApiKey: originalProject.encryptedApiKey,
      databaseName: originalProject.databaseName,
      schemaCache: originalProject.schemaCache,
      createdBy: userId
    });

    log.info(`Project duplicated: ${originalProject.name} -> ${copyName}`);

    res.status(201).json({
      success: true,
      message: 'Project duplicated successfully',
      data: {
        project: {
          id: duplicatedProject._id,
          name: duplicatedProject.name,
          databaseName: duplicatedProject.databaseName,
          createdAt: duplicatedProject.createdAt
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

export const validateConnection = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const startTime = Date.now();
  log.section('VALIDATING MONGODB CONNECTION');
  
  try {
    const { mongoUri } = req.body;
    log.step(1, 3, 'Received connection validation request');
    log.table({ mongoUri: mongoUri.substring(0, 50) + '...' });

    log.step(2, 3, 'Validating connection');
    const mongoService = new MongoDBService(mongoUri);
    const connectionInfo = await mongoService.validateConnection();

    if (!connectionInfo.isValid) {
      log.error('Connection validation failed', connectionInfo.error);
      throw new ValidationError(connectionInfo.error || 'Connection validation failed');
    }

    log.success('Connection validated successfully');
    log.table({
      'Database Name': connectionInfo.databaseName,
      'Read-Only': connectionInfo.isReadOnly ? 'Yes' : 'No'
    });

    log.step(3, 3, 'Fetching database statistics');
    const stats = await mongoService.getDatabaseStats();
    log.success('Database statistics retrieved');
    log.table({
      'Collections': stats.collections,
      'Data Size': `${(stats.dataSize / 1024 / 1024).toFixed(2)} MB`,
      'Storage Size': `${(stats.storageSize / 1024 / 1024).toFixed(2)} MB`,
      'Indexes': stats.indexes
    });

    const duration = Date.now() - startTime;
    log.timing('Total validation time', duration);
    log.separator();

    res.json({
      success: true,
      message: 'Connection validated successfully',
      data: {
        isValid: true,
        databaseName: connectionInfo.databaseName,
        isReadOnly: connectionInfo.isReadOnly,
        stats: {
          collections: stats.collections,
          totalDocuments: stats.dataSize,
          sizeOnDisk: stats.storageSize
        }
      }
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    log.error('Connection validation failed', error);
    log.timing('Failed validation time', duration);
    log.separator();
    next(error);
  }
};

export const listDatabases = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const startTime = Date.now();
  log.section('LISTING DATABASES FROM CLUSTER');
  
  try {
    const { mongoUri } = req.body;
    log.step(1, 4, 'Received database listing request');
    log.table({ mongoUri: mongoUri.substring(0, 50) + '...' });

    // Generate cache key from URI
    const cacheKey = `databases:${Buffer.from(mongoUri).toString('base64')}`;
    
    log.step(2, 4, 'Checking cache for database list');
    const cachedDatabases = await cacheService.get<DatabaseInfo[]>(cacheKey);
    
    if (cachedDatabases && cachedDatabases.length > 0) {
      log.success('Database list found in cache');
      log.table({
        'Cached Databases': cachedDatabases.length,
        'Cache Key': cacheKey.substring(0, 30) + '...'
      });

      const duration = Date.now() - startTime;
      log.timing('Total time (from cache)', duration);
      log.separator();

      return res.json({
        success: true,
        message: 'Databases retrieved from cache',
        data: {
          databases: cachedDatabases,
          fromCache: true
        }
      });
    }

    log.step(3, 4, 'Fetching databases from cluster');
    const mongoService = new MongoDBService(mongoUri);
    const databases = await mongoService.listDatabasesInCluster();

    log.success(`Retrieved ${databases.length} databases from cluster`);
    log.table({
      'Total Databases': databases.length,
      'Cache Key': cacheKey.substring(0, 30) + '...'
    });

    log.step(4, 4, 'Caching database list');
    // Cache for 1 hour (3600 seconds)
    await cacheService.set(cacheKey, databases, 3600);
    log.success('Database list cached for 1 hour');

    const duration = Date.now() - startTime;
    log.timing('Total time (fresh fetch)', duration);
    log.separator();

    res.json({
      success: true,
      message: 'Databases retrieved successfully',
      data: {
        databases,
        fromCache: false
      }
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    log.error('Failed to list databases', error);
    log.timing('Failed listing time', duration);
    log.separator();
    next(error);
  }
};

export const getProjectStats = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { organizationId } = req.user!;

    const [total, recentlyAccessed, withSchema] = await Promise.all([
      Project.countDocuments({ organizationId }),
      Project.countDocuments({
        organizationId,
        lastAccessed: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
      }),
      Project.countDocuments({
        organizationId,
        'schemaCache.collections': { $exists: true, $ne: [] }
      })
    ]);

    res.json({
      success: true,
      data: {
        stats: {
          total,
          recentlyAccessed,
          withSchema,
          withoutSchema: total - withSchema
        }
      }
    });
  } catch (error) {
    next(error);
  }
};
