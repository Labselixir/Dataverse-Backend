import { createClient, RedisClientType } from 'redis';
import { logger } from '../utils/logger';

export class CacheService {
  private client: RedisClientType | null = null;
  private isConnected: boolean = false;

  constructor() {
    this.initializeRedis();
  }

  private async initializeRedis(): Promise<void> {
    if (!process.env.REDIS_URL) {
      logger.warn('Redis URL not configured, caching disabled');
      return;
    }

    try {
      const redisUrl = process.env.REDIS_URL;
      
      // Configure Redis client with SSL support for Redis Cloud
      const clientConfig: any = {
        url: redisUrl,
        socket: {
          // Disable automatic reconnection - we'll handle it gracefully
          reconnectStrategy: () => {
            return new Error('Redis connection failed - caching disabled');
          },
          // Timeout settings
          connectTimeout: 5000,
          keepAlive: 30000
        }
      };

      // Enable TLS for rediss:// URLs (Redis Cloud)
      if (redisUrl.startsWith('rediss://')) {
        clientConfig.socket.tls = true;
        // For Redis Cloud, we need to be less strict with certificate validation
        clientConfig.socket.rejectUnauthorized = false;
      }

      this.client = createClient(clientConfig);

      let errorLogged = false;

      this.client.on('error', (err: any) => {
        // Only log connection errors once, not repeatedly
        if (!errorLogged) {
          logger.warn(`Redis connection error: ${err.message || err}. Application will work without caching.`);
          errorLogged = true;
        }
        this.isConnected = false;
      });

      this.client.on('connect', () => {
        logger.info('✓ Redis connected successfully');
        this.isConnected = true;
        errorLogged = false;
      });

      this.client.on('ready', () => {
        logger.info('✓ Redis client ready');
      });

      // Try to connect with timeout
      const connectPromise = this.client.connect();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Redis connection timeout')), 5000)
      );

      try {
        await Promise.race([connectPromise, timeoutPromise]);
        logger.info('✓ Redis initialized successfully');
      } catch (error: any) {
        logger.warn(`Redis unavailable: ${error.message}. Application will work without caching.`);
        this.client = null;
        this.isConnected = false;
      }
    } catch (error: any) {
      logger.warn(`Redis initialization failed: ${error.message}. Application will work without caching.`);
      this.client = null;
    }
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.client || !this.isConnected) {
      return null;
    }

    try {
      const value = await this.client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.error(`Cache get error for key ${key}:`, error);
      return null;
    }
  }

  async set(key: string, value: any, ttl?: number): Promise<void> {
    if (!this.client || !this.isConnected) {
      return;
    }

    try {
      const stringValue = JSON.stringify(value);
      
      if (ttl) {
        await this.client.setEx(key, ttl, stringValue);
      } else {
        await this.client.set(key, stringValue);
      }
    } catch (error) {
      logger.error(`Cache set error for key ${key}:`, error);
    }
  }

  async delete(key: string): Promise<void> {
    if (!this.client || !this.isConnected) {
      return;
    }

    try {
      await this.client.del(key);
    } catch (error) {
      logger.error(`Cache delete error for key ${key}:`, error);
    }
  }

  async flush(): Promise<void> {
    if (!this.client || !this.isConnected) {
      return;
    }

    try {
      await this.client.flushAll();
      logger.info('Cache flushed');
    } catch (error) {
      logger.error('Cache flush error:', error);
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.isConnected = false;
      logger.info('Redis disconnected');
    }
  }
}