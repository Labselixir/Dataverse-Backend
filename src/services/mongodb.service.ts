import { MongoClient, Db, Collection } from 'mongodb';
import { DatabaseConnectionError, ValidationError } from '../utils/errors';
import { createStructuredLogger } from '../utils/logger';
import { CONSTANTS } from '../utils/constants';

export interface ConnectionInfo {
  isValid: boolean;
  databaseName?: string;
  isReadOnly?: boolean;
  error?: string;
}

export interface DatabaseStats {
  collections: number;
  dataSize: number;
  storageSize: number;
  indexes: number;
}

export interface DatabaseInfo {
  name: string;
  sizeOnDisk: number;
}

/**
 * Connection Pool Manager - Singleton pattern
 * Manages reusable MongoDB connections to avoid creating new connections for each operation
 */
class ConnectionPoolManager {
  private static instance: ConnectionPoolManager;
  private pools: Map<string, { client: MongoClient; lastUsed: Date; refCount: number }> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private log = createStructuredLogger('ConnectionPoolManager');

  private constructor() {
    this.startCleanupInterval();
  }

  static getInstance(): ConnectionPoolManager {
    if (!ConnectionPoolManager.instance) {
      ConnectionPoolManager.instance = new ConnectionPoolManager();
    }
    return ConnectionPoolManager.instance;
  }

  async getConnection(connectionString: string): Promise<MongoClient> {
    if (!connectionString) {
      throw new Error('Connection string is required');
    }

    const poolKey = this.hashConnectionString(connectionString);
    const existingPool = this.pools.get(poolKey);

    if (existingPool) {
      this.log.debug(`Reusing existing connection from pool`, { poolKey, refCount: existingPool.refCount + 1 });
      existingPool.refCount++;
      existingPool.lastUsed = new Date();
      return existingPool.client;
    }

    this.log.info(`Creating new MongoDB connection`, { poolKey });
    const client = new MongoClient(connectionString, {
      serverSelectionTimeoutMS: CONSTANTS.MONGODB.CONNECTION_TIMEOUT,
      maxPoolSize: CONSTANTS.MONGODB.MAX_POOL_SIZE,
      // SSL/TLS configuration for development
      tls: true,
      tlsInsecure: process.env.NODE_ENV !== 'production', // Skip cert validation in dev
      retryWrites: true
    });

    await client.connect();
    this.log.success(`MongoDB connection established`, { poolKey });

    this.pools.set(poolKey, {
      client,
      lastUsed: new Date(),
      refCount: 1
    });

    return client;
  }

  releaseConnection(connectionString: string): void {
    const poolKey = this.hashConnectionString(connectionString);
    const pool = this.pools.get(poolKey);

    if (pool) {
      pool.refCount--;
      pool.lastUsed = new Date();
      this.log.debug(`Connection released`, { poolKey, refCount: pool.refCount });
    }
  }

  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      const now = new Date();
      const idleTimeout = CONSTANTS.CACHE.CONNECTION_POOL_IDLE;

      for (const [key, pool] of this.pools.entries()) {
        const idleTime = now.getTime() - pool.lastUsed.getTime();
        if (idleTime > idleTimeout && pool.refCount === 0) {
          this.log.info(`Closing idle connection`, { poolKey: key, idleTimeMs: idleTime });
          pool.client.close().catch(err => {
            this.log.error(`Failed to close idle connection`, err);
          });
          this.pools.delete(key);
        }
      }
    }, 60000); // Check every minute
  }

  private hashConnectionString(connectionString: string): string {
    // Simple hash to create a unique key for each connection string
    let hash = 0;
    for (let i = 0; i < connectionString.length; i++) {
      const char = connectionString.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return `pool_${Math.abs(hash)}`;
  }

  async closeAll(): Promise<void> {
    this.log.info(`Closing all connections in pool`, { count: this.pools.size });
    for (const [key, pool] of this.pools.entries()) {
      await pool.client.close();
      this.log.debug(`Connection closed`, { poolKey: key });
    }
    this.pools.clear();

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }

  getPoolStats(): { poolKey: string; refCount: number; lastUsed: Date }[] {
    return Array.from(this.pools.entries()).map(([key, pool]) => ({
      poolKey: key,
      refCount: pool.refCount,
      lastUsed: pool.lastUsed
    }));
  }
}

export class MongoDBService {
  private client: MongoClient | null = null;
  private connectionString: string;
  private connectionTimeout: number;
  private poolManager: ConnectionPoolManager;
  private log = createStructuredLogger('MongoDBService');
  private isConnected: boolean = false;

  constructor(connectionString: string) {
    this.connectionString = connectionString;
    this.connectionTimeout = CONSTANTS.MONGODB.CONNECTION_TIMEOUT;
    this.poolManager = ConnectionPoolManager.getInstance();
  }

  async connect(): Promise<void> {
    try {
      this.log.step(1, 3, 'Acquiring MongoDB connection from pool');
      this.client = await this.poolManager.getConnection(this.connectionString);
      this.isConnected = true;
      this.log.success('Connection acquired successfully');
    } catch (error: any) {
      this.log.error('Failed to acquire connection', error);
      throw new DatabaseConnectionError(error.message);
    }
  }

  async disconnect(): Promise<void> {
    if (this.client && this.isConnected) {
      this.log.step(1, 1, 'Releasing connection back to pool');
      this.poolManager.releaseConnection(this.connectionString);
      this.isConnected = false;
      this.log.success('Connection released');
    }
  }

  async validateConnection(): Promise<ConnectionInfo> {
    const startTime = Date.now();
    this.log.section('VALIDATING MONGODB CONNECTION');
    
    try {
      this.log.step(1, 4, 'Connecting to MongoDB');
      await this.connect();
      
      if (!this.client) {
        this.log.error('Connection object is null after connect');
        return { isValid: false, error: 'Failed to establish connection' };
      }
      this.log.success('Connected to MongoDB');

      this.log.step(2, 4, 'Extracting database name from URI');
      const dbName = this.extractDatabaseName();
      if (!dbName) {
        this.log.error('No database name found in URI');
        return { isValid: false, error: 'No database specified in URI' };
      }
      this.log.success(`Database identified: ${dbName}`);

      this.log.step(3, 4, 'Testing connection with ping command');
      const db = this.client.db(dbName);
      await db.command({ ping: 1 });
      this.log.success('Ping command successful');

      this.log.step(4, 4, 'Checking read-only permissions');
      const isReadOnly = await this.checkReadOnly(db);
      this.log.success(`Read-only status: ${isReadOnly ? 'Yes (Read-Only)' : 'No (Read-Write)'}`);

      const duration = Date.now() - startTime;
      this.log.timing('Total validation time', duration);

      return {
        isValid: true,
        databaseName: dbName,
        isReadOnly
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      this.log.error('Connection validation failed', error);
      this.log.timing('Failed validation time', duration);
      return {
        isValid: false,
        error: error.message || 'Connection validation failed'
      };
    } finally {
      await this.disconnect();
    }
  }

  private extractDatabaseName(): string | null {
    try {
      const url = new URL(this.connectionString.replace('mongodb://', 'http://').replace('mongodb+srv://', 'https://'));
      const pathname = url.pathname;
      return pathname.slice(1).split('?')[0] || null;
    } catch {
      return null;
    }
  }

  private async checkReadOnly(db: Db): Promise<boolean> {
    try {
      // Try to create a temporary collection
      const tempName = `_temp_${Date.now()}`;
      await db.createCollection(tempName);
      await db.dropCollection(tempName);
      return false;
    } catch {
      return true;
    }
  }

  async getDatabaseStats(): Promise<DatabaseStats> {
    if (!this.client) {
      throw new DatabaseConnectionError('Not connected to database');
    }

    const dbName = this.extractDatabaseName();
    if (!dbName) {
      throw new ValidationError('No database name found');
    }

    const db = this.client.db(dbName);
    const stats = await db.stats();

    return {
      collections: stats.collections,
      dataSize: stats.dataSize,
      storageSize: stats.storageSize,
      indexes: stats.indexes
    };
  }

  async listCollections(databaseName: string): Promise<string[]> {
    if (!this.client) {
      throw new DatabaseConnectionError('Not connected to database');
    }

    const db = this.client.db(databaseName);
    const collections = await db.listCollections().toArray();
    
    return collections
      .filter(col => !col.name.startsWith('system.'))
      .map(col => col.name);
  }

  async getCollectionSample(
    databaseName: string,
    collectionName: string,
    sampleSize: number = 100
  ): Promise<any[]> {
    if (!this.client) {
      throw new DatabaseConnectionError('Not connected to database');
    }

    const db = this.client.db(databaseName);
    const collection = db.collection(collectionName);
    
    const samples = await collection
      .aggregate([{ $sample: { size: sampleSize } }])
      .toArray();
    
    return samples;
  }

  async getCollectionCount(
    databaseName: string,
    collectionName: string
  ): Promise<number> {
    if (!this.client) {
      throw new DatabaseConnectionError('Not connected to database');
    }

    const db = this.client.db(databaseName);
    const collection = db.collection(collectionName);
    
    return await collection.countDocuments();
  }

  async getCollectionIndexes(
    databaseName: string,
    collectionName: string
  ): Promise<any[]> {
    if (!this.client) {
      throw new DatabaseConnectionError('Not connected to database');
    }

    const db = this.client.db(databaseName);
    const collection = db.collection(collectionName);
    
    return await collection.indexes();
  }

  async getFieldValueDistribution(
    databaseName: string,
    collectionName: string,
    fieldName: string,
    limit: number = 100
  ): Promise<Array<{ value: any; count: number }>> {
    if (!this.client) {
      throw new DatabaseConnectionError('Not connected to database');
    }

    const db = this.client.db(databaseName);
    const collection = db.collection(collectionName);
    
    const distribution = await collection.aggregate([
      { $group: { _id: `$${fieldName}`, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: limit }
    ]).toArray();
    
    return distribution.map(item => ({
      value: item._id,
      count: item.count
    }));
  }

  async executeReadQuery(
    databaseName: string,
    collectionName: string,
    query: any,
    options: any = {}
  ): Promise<any[]> {
    if (!this.client) {
      throw new DatabaseConnectionError('Not connected to database');
    }

    const db = this.client.db(databaseName);
    const collection = db.collection(collectionName);
    
    return await collection.find(query, options).toArray();
  }

  async executeAggregation(
    databaseName: string,
    collectionName: string,
    pipeline: any[]
  ): Promise<any[]> {
    if (!this.client) {
      throw new DatabaseConnectionError('Not connected to database');
    }

    const db = this.client.db(databaseName);
    const collection = db.collection(collectionName);
    
    return await collection.aggregate(pipeline).toArray();
  }

  async listDatabasesInCluster(): Promise<DatabaseInfo[]> {
    const startTime = Date.now();
    this.log.section('LISTING DATABASES IN CLUSTER');
    
    try {
      this.log.step(1, 3, 'Connecting to cluster');
      await this.connect();
      
      if (!this.client) {
        this.log.error('Connection object is null after connect');
        throw new DatabaseConnectionError('Failed to establish connection');
      }
      this.log.success('Connected to cluster');

      this.log.step(2, 3, 'Fetching database list from admin');
      const admin = this.client.db().admin();
      const result = await admin.listDatabases();
      this.log.success(`Found ${result.databases.length} databases`);

      this.log.step(3, 3, 'Processing database information');
      const databases: DatabaseInfo[] = result.databases.map(db => ({
        name: db.name,
        sizeOnDisk: db.sizeOnDisk || 0
      }));

      // Log database details
      this.log.table({
        'Total Databases': databases.length,
        'Largest Database': databases.length > 0 
          ? `${databases.reduce((max, db) => db.sizeOnDisk > max.sizeOnDisk ? db : max).name} (${(databases.reduce((max, db) => db.sizeOnDisk > max.sizeOnDisk ? db : max).sizeOnDisk / 1024 / 1024).toFixed(2)} MB)`
          : 'N/A'
      });

      const duration = Date.now() - startTime;
      this.log.timing('Total database listing time', duration);
      this.log.separator();

      return databases;
    } catch (error: any) {
      const duration = Date.now() - startTime;
      this.log.error('Failed to list databases', error);
      this.log.timing('Failed listing time', duration);
      this.log.separator();
      throw new DatabaseConnectionError(error.message || 'Failed to list databases');
    } finally {
      await this.disconnect();
    }
  }
}