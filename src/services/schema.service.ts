import { MongoDBService } from './mongodb.service';
import { CacheService } from './cache.service';
import { 
  SchemaExtraction, 
  CollectionSchema, 
  FieldSchema, 
  Relationship 
} from '../types';
import { createStructuredLogger } from '../utils/logger';
import { REGEX_PATTERNS, CONSTANTS } from '../utils/constants';

const log = createStructuredLogger('SchemaService');

export class SchemaService {
  private cacheService: CacheService;

  constructor() {
    this.cacheService = new CacheService();
  }

  async extractAndCacheSchema(
    projectId: string,
    connectionString: string,
    persistToDb: boolean = true
  ): Promise<SchemaExtraction | null> {
    const cacheKey = `schema:${projectId}`;
    
    try {
      // Check cache first
      const cached = await this.cacheService.get<SchemaExtraction>(cacheKey);
      if (cached) {
        log.debug(`Schema found in cache for project ${projectId}`);
        return cached;
      }

      // Extract fresh schema
      const schema = await this.extractSchema(connectionString);
      
      // Cache the result
      await this.cacheService.set(cacheKey, schema, CONSTANTS.CACHE.SCHEMA_TTL);
      
      // Persist to database if requested
      if (persistToDb && schema) {
        await this.persistSchemaToDB(projectId, schema);
      }
      
      return schema;
    } catch (error: any) {
      log.error(`Failed to extract schema for project ${projectId}`, error);
      return null;
    }
  }

  private async persistSchemaToDB(projectId: string, schema: SchemaExtraction): Promise<void> {
    try {
      const { Project } = await import('../models/Project');
      const project = await Project.findById(projectId);
      
      if (project) {
        log.debug(`Updating schema cache for project ${projectId}`, {
          collections: schema.collections.length,
          relationships: schema.relationships.length
        });
        
        await project.updateSchemaCache(schema);
        
        log.success(`Schema persisted to database for project ${projectId}`, {
          collections: schema.collections.length,
          relationships: schema.relationships.length,
          lastSynced: project.schemaCache?.lastSynced
        });
      } else {
        log.warn(`Project not found for schema persistence: ${projectId}`);
      }
    } catch (error: any) {
      log.error(`Failed to persist schema to database for project ${projectId}:`, error);
      // Don't throw - schema is still cached in Redis
    }
  }

  private async extractSchema(connectionString: string): Promise<SchemaExtraction> {
    const startTime = Date.now();
    log.section('EXTRACTING DATABASE SCHEMA');
    
    const mongoService = new MongoDBService(connectionString);
    
    try {
      log.step(1, 4, 'Connecting to MongoDB');
      await mongoService.connect();
      log.success('Connected successfully');
      
      log.step(2, 4, 'Listing collections');
      const dbName = this.extractDatabaseName(connectionString);
      const collectionNames = await mongoService.listCollections(dbName);
      log.success(`Found ${collectionNames.length} collections`, { collections: collectionNames });
      
      log.step(3, 4, 'Analyzing collections');
      const collections: CollectionSchema[] = [];
      let totalDocuments = 0;
      
      for (let i = 0; i < collectionNames.length; i++) {
        const collectionName = collectionNames[i];
        log.debug(`Analyzing collection [${i + 1}/${collectionNames.length}]: ${collectionName}`);
        const collectionSchema = await this.analyzeCollection(
          mongoService,
          dbName,
          collectionName
        );
        collections.push(collectionSchema);
        totalDocuments += collectionSchema.documentCount;
        log.debug(`  └─ Fields: ${collectionSchema.fields.length}, Documents: ${collectionSchema.documentCount}`);
      }
      log.success(`Analyzed ${collections.length} collections`);
      
      log.step(4, 4, 'Detecting relationships');
      const relationships = this.detectRelationships(collections);
      log.success(`Detected ${relationships.length} relationships`);
      
      await mongoService.disconnect();
      
      const duration = Date.now() - startTime;
      log.timing('Total schema extraction time', duration);
      log.separator();
      
      return {
        collections,
        relationships,
        stats: {
          totalCollections: collections.length,
          totalDocuments,
          averageFieldCount: this.calculateAverageFieldCount(collections)
        }
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      log.error('Schema extraction failed', error);
      log.timing('Failed extraction time', duration);
      log.separator();
      await mongoService.disconnect();
      throw error;
    }
  }

  private async analyzeCollection(
    mongoService: MongoDBService,
    databaseName: string,
    collectionName: string
  ): Promise<CollectionSchema> {
    const [samples, count, indexes] = await Promise.all([
      mongoService.getCollectionSample(databaseName, collectionName, CONSTANTS.MONGODB.SAMPLE_SIZE),
      mongoService.getCollectionCount(databaseName, collectionName),
      mongoService.getCollectionIndexes(databaseName, collectionName)
    ]);

    const fields = this.analyzeFields(samples);
    const sampleDocument = samples[0] || null;

    return {
      name: collectionName,
      fields,
      indexes,
      documentCount: count,
      sampleDocument
    };
  }

  private analyzeFields(samples: any[]): FieldSchema[] {
    if (samples.length === 0) return [];

    const fieldMap = new Map<string, FieldSchema>();

    for (const doc of samples) {
      this.extractFieldsFromDocument(doc, '', fieldMap);
    }

    // Extract sample values for each field
    const fields = Array.from(fieldMap.values());
    for (const field of fields) {
      field.sampleValues = this.extractSampleValuesForField(samples, field.name);
    }

    return fields;
  }

  private extractFieldsFromDocument(
    obj: any,
    prefix: string,
    fieldMap: Map<string, FieldSchema>,
    depth: number = 0
  ): void {
    if (depth > 3) return; // Limit nesting depth

    for (const [key, value] of Object.entries(obj)) {
      const fieldPath = prefix ? `${prefix}.${key}` : key;

      if (!fieldMap.has(fieldPath)) {
        fieldMap.set(fieldPath, this.createFieldSchema(key, value));
      } else {
        this.updateFieldSchema(fieldMap.get(fieldPath)!, value);
      }

      if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
        this.extractFieldsFromDocument(value, fieldPath, fieldMap, depth + 1);
      }
    }
  }

  private extractSampleValuesForField(samples: any[], fieldName: string): any[] {
    const values: any[] = [];

    for (const doc of samples) {
      const value = this.getNestedValue(doc, fieldName);
      if (value !== undefined) {
        values.push(value);
        if (values.length >= 3) break; // Only collect up to 3 sample values
      }
    }

    return values;
  }

  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => {
      return current && current[key] !== undefined ? current[key] : undefined;
    }, obj);
  }

  private createFieldSchema(name: string, value: any): FieldSchema {
    return {
      name,
      type: this.getFieldType(value),
      required: value !== null && value !== undefined,
      isArray: Array.isArray(value),
      isNested: typeof value === 'object' && !Array.isArray(value) && value !== null && !(value instanceof Date),
      enumValues: undefined,
      nestedSchema: undefined
    };
  }

  private updateFieldSchema(field: FieldSchema, value: any): void {
    if (value === null || value === undefined) {
      field.required = false;
    }

    const currentType = this.getFieldType(value);
    if (field.type !== currentType && currentType !== 'null') {
      field.type = 'mixed';
    }
  }

  private getFieldType(value: any): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (Array.isArray(value)) return 'array';
    if (value instanceof Date) return 'date';
    if (typeof value === 'object') {
      if (value._id) return 'objectId';
      return 'object';
    }
    return typeof value;
  }

  public detectRelationships(collections: CollectionSchema[]): Relationship[] {
    const relationships: Relationship[] = [];
    const collectionNames = new Set(collections.map(c => c.name));

    for (const collection of collections) {
      for (const field of collection.fields) {
        // Check if field name matches reference pattern
        if (REGEX_PATTERNS.COLLECTION_REFERENCE.test(field.name)) {
          const referencedCollection = this.extractReferencedCollection(field.name, collectionNames);
          
          if (referencedCollection) {
            relationships.push({
              from: collection.name,
              to: referencedCollection,
              field: field.name,
              type: field.isArray ? 'one-to-many' : 'one-to-one',
              direction: 'forward'
            });
          }
        }

        // Check for common reference patterns in field values
        if (field.type === 'objectId' && field.name !== '_id') {
          const possibleCollection = this.inferCollectionFromFieldName(field.name, collectionNames);
          
          if (possibleCollection) {
            relationships.push({
              from: collection.name,
              to: possibleCollection,
              field: field.name,
              type: field.isArray ? 'one-to-many' : 'one-to-one',
              direction: 'forward'
            });
          }
        }
      }
    }

    return this.deduplicateRelationships(relationships);
  }

  private extractReferencedCollection(fieldName: string, collectionNames: Set<string>): string | null {
    const baseName = fieldName.replace(/_(id|Id|ID|ref|Ref|REF)$/, '');
    
    // Try exact match
    if (collectionNames.has(baseName)) return baseName;
    
    // Try pluralized version
    const plural = `${baseName}s`;
    if (collectionNames.has(plural)) return plural;
    
    // Try singular version
    const singular = baseName.endsWith('s') ? baseName.slice(0, -1) : baseName;
    if (collectionNames.has(singular)) return singular;
    
    return null;
  }

  private inferCollectionFromFieldName(fieldName: string, collectionNames: Set<string>): string | null {
    const patterns = [
      /^(.+)Id$/,
      /^(.+)_id$/,
      /^(.+)Ref$/,
      /^(.+)_ref$/
    ];

    for (const pattern of patterns) {
      const match = fieldName.match(pattern);
      if (match) {
        const baseName = match[1];
        return this.extractReferencedCollection(baseName, collectionNames);
      }
    }

    return null;
  }

  private deduplicateRelationships(relationships: Relationship[]): Relationship[] {
    const seen = new Set<string>();
    const unique: Relationship[] = [];

    for (const rel of relationships) {
      const key = `${rel.from}-${rel.to}-${rel.field}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(rel);
      }
    }

    return unique;
  }

  private calculateAverageFieldCount(collections: CollectionSchema[]): number {
    if (collections.length === 0) return 0;
    
    const totalFields = collections.reduce((sum, col) => sum + col.fields.length, 0);
    return Math.round(totalFields / collections.length);
  }

  private extractDatabaseName(connectionString: string): string {
    const url = new URL(connectionString.replace('mongodb://', 'http://').replace('mongodb+srv://', 'https://'));
    return url.pathname.slice(1).split('?')[0];
  }
}