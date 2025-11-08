import { Response, NextFunction } from 'express';
import { Project } from '../models/Project';
import { AuthRequest } from '../types';
import { NotFoundError, ValidationError } from '../utils/errors';
import { SchemaService } from '../services/schema.service';
import { MongoDBService } from '../services/mongodb.service';
import { CacheService } from '../services/cache.service';
import { logger } from '../utils/logger';
import { CONSTANTS } from '../utils/constants';

export const extractSchema = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const { organizationId } = req.user!;

    const project = await Project.findOne({
      _id: id,
      organizationId
    });

    if (!project) {
      throw new NotFoundError('Project');
    }

    const decryptedUri = project.getDecryptedUri();
    const schemaService = new SchemaService();
    const schema = await schemaService.extractAndCacheSchema(id, decryptedUri, true);

    if (!schema) {
      throw new ValidationError('Failed to extract schema');
    }

    logger.info(`Schema extracted for project: ${project.name}`);

    res.json({
      success: true,
      message: 'Schema extracted successfully',
      data: {
        schema: {
          collections: schema.collections.map(col => ({
            name: col.name,
            fields: col.fields,
            documentCount: col.documentCount,
            indexes: col.indexes
          })),
          relationships: schema.relationships,
          stats: schema.stats
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

export const refreshSchema = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const { organizationId } = req.user!;
    const { force = false } = req.body;

    const project = await Project.findOne({
      _id: id,
      organizationId
    });

    if (!project) {
      throw new NotFoundError('Project');
    }

    // Check if refresh is needed
    if (!force && !project.needsSchemaRefresh()) {
      res.json({
        success: true,
        message: 'Schema is already up to date',
        data: {
          schema: project.schemaCache
        }
      });
      return;
    }

    const decryptedUri = project.getDecryptedUri();
    const schemaService = new SchemaService();
    const schema = await schemaService.extractAndCacheSchema(id, decryptedUri);

    // Update project
    project.schemaCache = {
      collections: schema.collections,
      relationships: schema.relationships,
      lastSynced: new Date()
    };
    await project.save();

    logger.info(`Schema refreshed for project: ${project.name}`);

    res.json({
      success: true,
      message: 'Schema refreshed successfully',
      data: {
        schema: {
          collections: schema.collections,
          relationships: schema.relationships,
          stats: schema.stats,
          lastSynced: project.schemaCache.lastSynced
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getCollectionSample = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id, name } = req.params;
    const { organizationId } = req.user!;
    const { limit = 5 } = req.query;

    const project = await Project.findOne({
      _id: id,
      organizationId
    });

    if (!project) {
      throw new NotFoundError('Project');
    }

    const decryptedUri = project.getDecryptedUri();
    const mongoService = new MongoDBService(decryptedUri);
    
    await mongoService.connect();
    const samples = await mongoService.getCollectionSample(
      project.databaseName,
      name,
      Number(limit)
    );
    await mongoService.disconnect();

    res.json({
      success: true,
      data: {
        collection: name,
        samples,
        count: samples.length
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getFieldDistribution = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id, name, field } = req.params;
    const { organizationId } = req.user!;

    const project = await Project.findOne({
      _id: id,
      organizationId
    });

    if (!project) {
      throw new NotFoundError('Project');
    }

    const decryptedUri = project.getDecryptedUri();
    const mongoService = new MongoDBService(decryptedUri);
    
    await mongoService.connect();
    const distribution = await mongoService.getFieldValueDistribution(
      project.databaseName,
      name,
      field
    );
    await mongoService.disconnect();

    res.json({
      success: true,
      data: {
        collection: name,
        field,
        distribution,
        uniqueValues: distribution.length,
        topValues: distribution.slice(0, 10)
      }
    });
  } catch (error) {
    next(error);
  }
};

export const detectRelationships = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const { organizationId } = req.user!;

    const project = await Project.findOne({
      _id: id,
      organizationId
    });

    if (!project) {
      throw new NotFoundError('Project');
    }

    if (!project.schemaCache?.collections) {
      throw new ValidationError('Schema must be extracted first');
    }

    const schemaService = new SchemaService();
    const relationships = schemaService.detectRelationships(project.schemaCache.collections);

    // Update project with detected relationships
    project.schemaCache.relationships = relationships;
    await project.save();

    res.json({
      success: true,
      data: {
        relationships,
        count: relationships.length
      }
    });
  } catch (error) {
    next(error);
  }
};