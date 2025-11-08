export interface QueryIntent {
  type: 'count' | 'find' | 'aggregate' | 'schema' | 'relationship' | 'general';
  collection?: string;
  collections?: string[];
  filters?: Record<string, any>;
  fields?: string[];
  aggregationStage?: string;
  limit?: number;
  confidence: number;
  explanation: string;
}

export interface GeneratedQuery {
  type: 'count' | 'find' | 'aggregate';
  collection: string;
  query: any;
  pipeline?: any[];
  options?: any;
  isValid: boolean;
  validationErrors: string[];
}

/**
 * QueryGenerator Service
 * Converts user intent and schema information into safe MongoDB queries
 */
export class QueryGeneratorService {
  /**
   * Parse user message to extract query intent
   */
  parseIntent(
    message: string,
    schemaCache: any
  ): QueryIntent {
    const lowerMessage = message.toLowerCase();
    const collections = schemaCache?.collections || [];
    const collectionNames = collections.map((c: any) => c.name.toLowerCase());

    // Detect query type
    let type: QueryIntent['type'] = 'general';
    if (lowerMessage.includes('count') || lowerMessage.includes('how many')) {
      type = 'count';
    } else if (lowerMessage.includes('aggregate') || lowerMessage.includes('group by')) {
      type = 'aggregate';
    } else if (lowerMessage.includes('find') || lowerMessage.includes('show') || lowerMessage.includes('get') ||
               lowerMessage.includes('see the data') || lowerMessage.includes('view data') ||
               lowerMessage.includes('peek') || lowerMessage.includes('look at')) {
      type = 'find';
    } else if (lowerMessage.includes('structure') || lowerMessage.includes('schema')) {
      type = 'schema';
    } else if (lowerMessage.includes('relationship') || lowerMessage.includes('reference')) {
      type = 'relationship';
    }

    // Extract mentioned collections
    const mentionedCollections: string[] = [];
    collectionNames.forEach((colName: string) => {
      if (lowerMessage.includes(colName)) {
        const originalCollection = collections.find(
          (c: any) => c.name.toLowerCase() === colName
        );
        if (originalCollection) {
          mentionedCollections.push(originalCollection.name);
        }
      }
    });

    // Extract filters and conditions
    const filters = this.extractFilters(message, mentionedCollections, schemaCache);

    // Extract fields
    const fields = this.extractFields(message, mentionedCollections, schemaCache);

    // Extract limit
    const limit = this.extractLimit(message);

    // Determine confidence
    const confidence = this.calculateConfidence(type, mentionedCollections, filters);

    return {
      type,
      collection: mentionedCollections[0],
      collections: mentionedCollections,
      filters,
      fields,
      limit,
      confidence,
      explanation: this.generateExplanation(type, mentionedCollections, filters)
    };
  }

  /**
   * Generate MongoDB query from intent
   */
  generateQuery(
    intent: QueryIntent,
    schemaCache: any
  ): GeneratedQuery {
    const validationErrors: string[] = [];

    // Validate collection exists
    if (!intent.collection) {
      validationErrors.push('No collection specified in query');
      return {
        type: 'find',
        collection: '',
        query: {},
        isValid: false,
        validationErrors
      };
    }

    const collections = schemaCache?.collections || [];
    const collection = collections.find((c: any) => c.name === intent.collection);

    if (!collection) {
      validationErrors.push(`Collection '${intent.collection}' not found in schema`);
      return {
        type: 'find',
        collection: intent.collection,
        query: {},
        isValid: false,
        validationErrors
      };
    }

    // Generate query based on type
    let generatedQuery: GeneratedQuery;

    switch (intent.type) {
      case 'count':
        generatedQuery = this.generateCountQuery(intent, collection);
        break;

      case 'find':
        generatedQuery = this.generateFindQuery(intent, collection);
        break;

      case 'aggregate':
        generatedQuery = this.generateAggregateQuery(intent, collection);
        break;

      default:
        generatedQuery = this.generateFindQuery(intent, collection);
    }

    // Validate the generated query
    const queryValidation = this.validateQuery(generatedQuery, collection);
    generatedQuery.isValid = queryValidation.isValid;
    generatedQuery.validationErrors = queryValidation.errors;

    return generatedQuery;
  }

  /**
   * Generate count query
   */
  private generateCountQuery(intent: QueryIntent, collection: any): GeneratedQuery {
    const query = intent.filters || {};

    return {
      type: 'count',
      collection: collection.name,
      query,
      isValid: true,
      validationErrors: []
    };
  }

  /**
   * Generate find query
   */
  private generateFindQuery(intent: QueryIntent, collection: any): GeneratedQuery {
    const query = intent.filters || {};
    const options: any = {};

    if (intent.fields && intent.fields.length > 0) {
      const projection: Record<string, number> = {};
      intent.fields.forEach(field => {
        projection[field] = 1;
      });
      options.projection = projection;
    } else {
      // Default projection: select up to 8 non-binary fields
      const fields = collection.fields?.filter((f: any) =>
        f.type !== 'Buffer' && f.type !== 'Binary' && f.name !== '_id'
      ).slice(0, 8) || [];
      if (fields.length > 0) {
        const projection: Record<string, number> = {};
        fields.forEach((field: any) => {
          projection[field.name] = 1;
        });
        options.projection = projection;
      }
    }

    if (intent.limit) {
      options.limit = intent.limit;
    } else {
      options.limit = 10; // Default limit for data viewing
    }

    return {
      type: 'find',
      collection: collection.name,
      query,
      options,
      isValid: true,
      validationErrors: []
    };
  }

  /**
   * Generate aggregation query
   */
  private generateAggregateQuery(intent: QueryIntent, collection: any): GeneratedQuery {
    const pipeline: any[] = [];

    // Add match stage if filters exist
    if (intent.filters && Object.keys(intent.filters).length > 0) {
      pipeline.push({ $match: intent.filters });
    }

    // Add group stage for aggregation
    if (intent.aggregationStage) {
      // Parse aggregation stage from message
      const groupStage = this.parseAggregationStage(intent.aggregationStage, collection);
      if (groupStage) {
        pipeline.push(groupStage);
      }
    }

    // Add limit
    if (intent.limit) {
      pipeline.push({ $limit: intent.limit });
    } else {
      pipeline.push({ $limit: 100 });
    }

    return {
      type: 'aggregate',
      collection: collection.name,
      pipeline,
      isValid: true,
      validationErrors: []
    };
  }

  /**
   * Extract filters from message
   */
  private extractFilters(
    message: string,
    collections: string[],
    schemaCache: any
  ): Record<string, any> {
    const filters: Record<string, any> = {};

    // Simple pattern matching for common filter patterns
    // "where status is active" -> { status: 'active' }
    const wherePattern = /where\s+(\w+)\s+(?:is|equals?|=)\s+([^\s,]+)/gi;
    let match;

    while ((match = wherePattern.exec(message)) !== null) {
      const fieldName = match[1];
      const fieldValue = match[2];

      // Try to parse value
      let parsedValue: any = fieldValue;
      if (fieldValue.toLowerCase() === 'true') parsedValue = true;
      else if (fieldValue.toLowerCase() === 'false') parsedValue = false;
      else if (!isNaN(Number(fieldValue))) parsedValue = Number(fieldValue);

      filters[fieldName] = parsedValue;
    }

    // Pattern for "status = active" or "status: active"
    const eqPattern = /(\w+)\s*[:=]\s*([^\s,]+)/g;
    while ((match = eqPattern.exec(message)) !== null) {
      const fieldName = match[1];
      const fieldValue = match[2];

      if (!filters[fieldName]) {
        let parsedValue: any = fieldValue;
        if (fieldValue.toLowerCase() === 'true') parsedValue = true;
        else if (fieldValue.toLowerCase() === 'false') parsedValue = false;
        else if (!isNaN(Number(fieldValue))) parsedValue = Number(fieldValue);

        filters[fieldName] = parsedValue;
      }
    }

    return filters;
  }

  /**
   * Extract fields from message
   */
  private extractFields(
    message: string,
    collections: string[],
    schemaCache: any
  ): string[] {
    const fields: string[] = [];

    if (!collections.length) return fields;

    const collectionSchema = schemaCache?.collections?.find(
      (c: any) => c.name === collections[0]
    );

    if (!collectionSchema) return fields;

    const fieldNames = collectionSchema.fields?.map((f: any) => f.name) || [];

    // Look for "show me" or "get" patterns
    const showPattern = /(?:show|get|display|select)\s+(?:me\s+)?([^,]+?)(?:\s+from|\s+in|$)/i;
    const showMatch = message.match(showPattern);

    if (showMatch) {
      const fieldPart = showMatch[1].toLowerCase();
      fieldNames.forEach((fieldName: string) => {
        if (fieldPart.includes(fieldName.toLowerCase())) {
          fields.push(fieldName);
        }
      });
    }

    return fields;
  }

  /**
   * Extract limit from message
   */
  private extractLimit(message: string): number | undefined {
    const limitPattern = /(?:limit|top|first)\s+(\d+)/i;
    const match = message.match(limitPattern);

    if (match) {
      const limit = parseInt(match[1], 10);
      return Math.min(limit, 1000); // Cap at 1000 for safety
    }

    return undefined;
  }

  /**
   * Calculate confidence score for the parsed intent
   */
  private calculateConfidence(
    type: QueryIntent['type'],
    collections: string[],
    filters: Record<string, any>
  ): number {
    let confidence = 0.5; // Base confidence

    // Increase confidence if collection is specified
    if (collections.length > 0) confidence += 0.3; // Higher for collection mention

    // Increase confidence if filters are extracted
    if (Object.keys(filters).length > 0) confidence += 0.15;

    // Increase confidence for specific query types
    if (type !== 'general') confidence += 0.15;

    // Boost confidence for data viewing intents with collections
    if (type === 'find' && collections.length > 0) confidence = Math.min(confidence + 0.2, 1);

    return Math.min(confidence, 1);
  }

  /**
   * Generate explanation of the parsed intent
   */
  private generateExplanation(
    type: QueryIntent['type'],
    collections: string[],
    filters: Record<string, any>
  ): string {
    let explanation = `${type} query`;

    if (collections.length > 0) {
      explanation += ` on ${collections.join(', ')}`;
    }

    if (Object.keys(filters).length > 0) {
      explanation += ` with filters: ${JSON.stringify(filters)}`;
    }

    return explanation;
  }

  /**
   * Parse aggregation stage from message
   */
  private parseAggregationStage(stage: string, collection: any): any {
    const lowerStage = stage.toLowerCase();

    // "group by status" -> { $group: { _id: '$status', count: { $sum: 1 } } }
    const groupByPattern = /group\s+by\s+(\w+)/i;
    const groupMatch = stage.match(groupByPattern);

    if (groupMatch) {
      const fieldName = groupMatch[1];
      return {
        $group: {
          _id: `$${fieldName}`,
          count: { $sum: 1 }
        }
      };
    }

    return null;
  }

  /**
   * Validate generated query for safety
   */
  private validateQuery(
    query: GeneratedQuery,
    collection: any
  ): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check query type is read-only
    if (!['count', 'find', 'aggregate'].includes(query.type)) {
      errors.push(`Query type '${query.type}' is not allowed`);
    }

    // Check for write operations in query
    if (query.query) {
      const queryStr = JSON.stringify(query.query);
      if (queryStr.includes('$set') || queryStr.includes('$unset') || 
          queryStr.includes('$push') || queryStr.includes('$pull') ||
          queryStr.includes('$inc') || queryStr.includes('$rename')) {
        errors.push('Write operations are not allowed');
      }
    }

    // Check pipeline for write operations
    if (query.pipeline) {
      const pipelineStr = JSON.stringify(query.pipeline);
      if (pipelineStr.includes('$out') || pipelineStr.includes('$merge') ||
          pipelineStr.includes('$set') || pipelineStr.includes('$unset')) {
        errors.push('Write operations in pipeline are not allowed');
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}
