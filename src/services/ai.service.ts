import Groq from 'groq-sdk';
import { ChatCompletionMessageParam } from 'groq-sdk/resources/chat/completions';
import { logger } from '../utils/logger';
import { ValidationError } from '../utils/errors';
import { QueryGeneratorService, QueryIntent } from './query-generator.service';
import { MongoDBService } from './mongodb.service';
import { DataFormatterService } from './data-formatter.service';

export interface AIResponse {
  content: string;
  model: string;
  tokens: number;
  queryType?: string;
  collections?: string[];
  suggestions?: string[];
  queryExecuted?: boolean;
  queryResult?: any;
}

export class AIService {
  private groq: Groq;
  private model: string = 'openai/gpt-oss-20b';
  private queryGenerator: QueryGeneratorService;
  private dataFormatter: DataFormatterService;

  constructor(apiKey: string) {
    this.groq = new Groq({ apiKey });
    this.queryGenerator = new QueryGeneratorService();
    this.dataFormatter = new DataFormatterService();
  }

  async generateResponse(
    message: string,
    schemaCache: any,
    chatHistory: any[],
    mongoUri?: string
  ): Promise<AIResponse> {
    try {
      // Step 1: Parse user intent
      const intent = this.queryGenerator.parseIntent(message, schemaCache);
      logger.info('Parsed intent:', { intent });

      let queryResult: any = null;
      let queryExecuted = false;
      let generatedQuery: any = null;

      // Step 2: If intent is specific enough and we have MongoDB URI, generate and execute query
      if (
        intent.confidence > 0.6 &&
        intent.type !== 'general' &&
        intent.type !== 'schema' &&
        intent.type !== 'relationship' &&
        mongoUri
      ) {
        try {
          generatedQuery = this.queryGenerator.generateQuery(intent, schemaCache);
          logger.info('Generated query:', { generatedQuery });

          if (generatedQuery.isValid) {
            // Step 3: Execute the query
            queryResult = await this.executeQuery(
              mongoUri,
              schemaCache.databaseName || 'dataverse',
              generatedQuery
            );
            queryExecuted = true;
            logger.info('Query executed successfully');
          } else {
            logger.warn('Generated query validation failed:', {
              errors: generatedQuery.validationErrors
            });
          }
        } catch (queryError: any) {
          logger.warn('Query execution failed, falling back to AI response:', queryError);
          // Continue with AI response even if query fails
        }
      }

      // Step 4: Generate AI response (with or without query results)
      const systemPrompt = this.buildSystemPrompt(schemaCache);
      const messages = this.buildMessageHistory(systemPrompt, message, chatHistory);

      // Add query result context if available
      if (queryResult && queryExecuted) {
        let resultContext = '';

        if (generatedQuery?.type === 'find' && Array.isArray(queryResult)) {
          // Format find results as structured data
          resultContext = `\n\n${this.dataFormatter.formatDataContext(
            generatedQuery.collection,
            queryResult
          )}`;
        } else if (generatedQuery?.type === 'count' && typeof queryResult === 'number') {
          // Format count results
          resultContext = `\n\n## Count Result\n\n**${generatedQuery.collection}** has **${this.dataFormatter['formatNumber'](queryResult)}** documents.`;
        } else {
          // Fallback for other types
          resultContext = `\n\nQuery Result:\n${JSON.stringify(queryResult, null, 2)}`;
        }

        const lastMessage = messages[messages.length - 1];
        if (lastMessage.role === 'user') {
          lastMessage.content = `${lastMessage.content}${resultContext}`;
        }
      }

      const completion = await this.groq.chat.completions.create({
        messages,
        model: this.model,
        temperature: 0.7,
        max_tokens: 2048,
        top_p: 1,
        stream: false
      });

      const response = completion.choices[0]?.message?.content || '';
      const tokens = completion.usage?.total_tokens || 0;

      // Analyze response for metadata
      const queryType = this.detectQueryType(message);
      const collections = this.extractCollections(message, schemaCache);
      const suggestions = this.generateFollowUpSuggestions(response, schemaCache);

      return {
        content: response,
        model: this.model,
        tokens,
        queryType,
        collections,
        suggestions,
        queryExecuted,
        queryResult
      };
    } catch (error: any) {
      logger.error('AI generation error:', error);
      throw new ValidationError(error.message || 'Failed to generate AI response');
    }
  }

  async streamResponse(
    message: string,
    schemaCache: any,
    chatHistory: any[],
    onChunk: (chunk: string) => void,
    onComplete: (metadata: any) => void
  ): Promise<void> {
    try {
      const systemPrompt = this.buildSystemPrompt(schemaCache);
      const messages = this.buildMessageHistory(systemPrompt, message, chatHistory);

      const stream = await this.groq.chat.completions.create({
        messages,
        model: this.model,
        temperature: 0.7,
        max_tokens: 2048,
        top_p: 1,
        stream: true
      });

      let fullContent = '';
      let tokenCount = 0;

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          fullContent += content;
          tokenCount++;
          onChunk(content);
        }
      }

      const metadata = {
        model: this.model,
        tokens: tokenCount,
        queryType: this.detectQueryType(message),
        collections: this.extractCollections(message, schemaCache)
      };

      onComplete(metadata);
    } catch (error: any) {
      logger.error('AI streaming error:', error);
      throw new ValidationError(error.message || 'Failed to stream AI response');
    }
  }

  async generateSuggestions(
    context: string,
    schemaCache: any
  ): Promise<string[]> {
    const collections = schemaCache?.collections || [];
    const suggestions: string[] = [];

    // Collection-specific suggestions
    if (collections.length > 0) {
      suggestions.push(`How many documents are in ${collections[0].name}?`);
      suggestions.push(`Show me the structure of ${collections[0].name}`);
      
      if (collections.length > 1) {
        suggestions.push(`What's the relationship between ${collections[0].name} and ${collections[1].name}?`);
      }
    }

    // Context-based suggestions
    if (context.toLowerCase().includes('user')) {
      suggestions.push('Show me recently created users');
      suggestions.push('What fields does the users collection have?');
      suggestions.push('Count users by status');
    }

    // General suggestions
    suggestions.push('Show me all collections in this database');
    suggestions.push('What are the largest collections?');
    suggestions.push('Find collections with relationships');

    return suggestions.slice(0, 5);
  }

  private buildSystemPrompt(schemaCache: any): string {
    const collections = schemaCache?.collections || [];
    const relationships = schemaCache?.relationships || [];

    let prompt = `You are Dataverse AI, an expert MongoDB database assistant. You help users understand and query their database.

DATABASE SCHEMA:
`;

    // Add collections
    if (collections.length > 0) {
      prompt += '\nCOLLECTIONS:\n';
      collections.forEach((col: any) => {
        prompt += `\n${col.name} (${col.documentCount} documents):\n`;
        const fields = col.fields?.slice(0, 10) || [];
        fields.forEach((field: any) => {
          prompt += `  - ${field.name}: ${field.type}${field.required ? ' (required)' : ''}\n`;
        });
        if (col.fields?.length > 10) {
          prompt += `  ... and ${col.fields.length - 10} more fields\n`;
        }
      });
    }

    // Add relationships
    if (relationships.length > 0) {
      prompt += '\nRELATIONSHIPS:\n';
      relationships.forEach((rel: any) => {
        prompt += `- ${rel.from} -> ${rel.to} (${rel.type}) via ${rel.field}\n`;
      });
    }

    prompt += `
FORMATTING GUIDELINES:
1. Keep responses conversational and easy to read:
   - Start with a simple, friendly summary
   - Use short paragraphs (2-3 sentences max)
   - Avoid dense walls of text
   - Use emojis sparingly for visual interest

2. For data presentation:
   - **Use proper markdown tables** for database schema, collections, and structured data
   - Format numbers naturally (e.g., "1,250" not "1250")
   - Use **bold** for important numbers and headers
   - Show database information in well-formatted tables

3. Table formatting rules:
   - Use | to separate columns
   - Use --- for table headers
   - Left-align text with colons (:---)
   - Include meaningful headers
   - Keep tables compact but readable

4. Response structure:
   - **Quick Summary**: 1-2 sentences about what you found
   - **Database Overview**: Table showing collections and key stats
   - **Schema Details**: Table with field information
   - **Key Insights**: 3-5 bullet points with important findings
   - **Examples**: 1-2 simple query examples (if relevant)
   - **Next Steps**: 1-2 suggestions for what to explore next

5. Make it conversational:
   - Write like you're explaining to a colleague
   - Use phrases like "Here's what I found:" or "You have:"
   - Keep technical terms minimal but accurate
   - Focus on insights, not just raw data

6. Content guidelines:
   - Provide clear, concise answers
   - Explain relationships between collections when relevant
   - For counts and statistics, provide specific numbers with context
   - Always ensure queries are read-only operations
   - If unsure, ask for clarification

Remember: You can only perform READ operations. Never suggest write, update, or delete operations.`;

    return prompt;
  }

  private buildMessageHistory(
    systemPrompt: string,
    currentMessage: string,
    chatHistory: any[]
  ): ChatCompletionMessageParam[] {
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt }
    ];

    // Add chat history
    chatHistory.forEach(hist => {
      messages.push({ role: 'user', content: hist.message });
      messages.push({ role: 'assistant', content: hist.aiResponse });
    });

    // Add current message
    messages.push({ role: 'user', content: currentMessage });

    return messages;
  }

  private detectQueryType(message: string): string {
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes('count') || lowerMessage.includes('how many')) {
      return 'count';
    }
    if (lowerMessage.includes('aggregate') || lowerMessage.includes('group by')) {
      return 'aggregate';
    }
    if (lowerMessage.includes('find') || lowerMessage.includes('show') || lowerMessage.includes('get')) {
      return 'find';
    }
    if (lowerMessage.includes('structure') || lowerMessage.includes('schema')) {
      return 'schema';
    }
    if (lowerMessage.includes('relationship') || lowerMessage.includes('reference')) {
      return 'relationship';
    }

    return 'general';
  }

  private extractCollections(message: string, schemaCache: any): string[] {
    const collections = schemaCache?.collections || [];
    const mentioned: string[] = [];
    const lowerMessage = message.toLowerCase();

    collections.forEach((col: any) => {
      if (lowerMessage.includes(col.name.toLowerCase())) {
        mentioned.push(col.name);
      }
    });

    return mentioned;
  }

  private generateFollowUpSuggestions(response: string, schemaCache: any): string[] {
    const suggestions: string[] = [];
    const collections = schemaCache?.collections || [];

    // Based on response content
    if (response.includes('documents')) {
      suggestions.push('Show me a sample document');
      suggestions.push('What are the most common field values?');
    }

    if (response.includes('relationship')) {
      suggestions.push('Explain this relationship in detail');
      suggestions.push('Show me related documents');
    }

    if (collections.length > 0) {
      const randomCollection = collections[Math.floor(Math.random() * collections.length)];
      suggestions.push(`Tell me about ${randomCollection.name}`);
    }

    return suggestions.slice(0, 3);
  }

  /**
   * Execute a generated query against MongoDB
   */
  private async executeQuery(
    mongoUri: string,
    databaseName: string,
    generatedQuery: any
  ): Promise<any> {
    const mongoService = new MongoDBService(mongoUri);

    try {
      await mongoService.connect();

      let result: any;

      switch (generatedQuery.type) {
        case 'count':
          result = await mongoService.getCollectionCount(
            databaseName,
            generatedQuery.collection
          );
          break;

        case 'find':
          result = await mongoService.executeReadQuery(
            databaseName,
            generatedQuery.collection,
            generatedQuery.query,
            generatedQuery.options
          );
          break;

        case 'aggregate':
          result = await mongoService.executeAggregation(
            databaseName,
            generatedQuery.collection,
            generatedQuery.pipeline
          );
          break;

        default:
          throw new ValidationError(`Unknown query type: ${generatedQuery.type}`);
      }

      return result;
    } finally {
      await mongoService.disconnect();
    }
  }
}