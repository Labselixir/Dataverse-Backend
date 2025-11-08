import { logger } from '../utils/logger';

/**
 * DataFormatter Service
 * Formats MongoDB query results into structured markdown for AI responses
 */
export class DataFormatterService {
  /**
   * Format query result into structured markdown context
   */
  formatDataContext(
    collectionName: string,
    documents: any[],
    totalCount?: number
  ): string {
    let context = `## Data Context: ${collectionName}\n\n`;

    // Add total count if available
    if (totalCount !== undefined) {
      context += `**Total documents:** ${this.formatNumber(totalCount)}\n\n`;
    }

    // Add sample count
    context += `**Sample shown:** ${documents.length} documents\n\n`;

    // Build markdown table
    if (documents.length > 0) {
      const table = this.buildMarkdownTable(documents);
      context += `### Sample Data\n\n${table}\n\n`;
    }

    // Add basic stats
    const stats = this.computeBasicStats(documents);
    if (stats.length > 0) {
      context += `### Quick Stats\n\n`;
      stats.forEach(stat => {
        context += `- ${stat}\n`;
      });
      context += '\n';
    }

    // Add raw sample (first 2 docs)
    if (documents.length > 0) {
      const rawSample = documents.slice(0, 2);
      context += `### Raw Sample (JSON)\n\n\`\`\`json\n${JSON.stringify(rawSample, null, 2)}\n\`\`\`\n\n`;
    }

    return context;
  }

  /**
   * Build markdown table from documents
   */
  private buildMarkdownTable(documents: any[]): string {
    if (documents.length === 0) return '';

    // Get all unique field names from the documents
    const allFields = new Set<string>();
    documents.forEach(doc => {
      Object.keys(doc).forEach(key => allFields.add(key));
    });

    const fields = Array.from(allFields).slice(0, 8); // Limit to 8 columns

    // Build header
    let table = '| ' + fields.join(' | ') + ' |\n';
    table += '|' + fields.map(() => '---').join('|') + '|\n';

    // Build rows
    documents.forEach(doc => {
      const row = fields.map(field => {
        const value = doc[field];
        return this.formatTableValue(value);
      });
      table += '| ' + row.join(' | ') + ' |\n';
    });

    return table;
  }

  /**
   * Format value for table display
   */
  private formatTableValue(value: any): string {
    if (value === null || value === undefined) {
      return '';
    }

    if (typeof value === 'string') {
      // Truncate long strings
      const truncated = value.length > 50 ? value.substring(0, 47) + '...' : value;
      // Escape pipes and newlines
      return truncated.replace(/\|/g, '\\|').replace(/\n/g, ' ');
    }

    if (typeof value === 'number') {
      return this.formatNumber(value);
    }

    if (typeof value === 'boolean') {
      return value ? '✓' : '✗';
    }

    if (value instanceof Date) {
      return value.toLocaleDateString();
    }

    if (Array.isArray(value)) {
      return `[${value.length} items]`;
    }

    if (typeof value === 'object') {
      if (value._bsontype === 'ObjectId') {
        return value.toString();
      }
      if (value._bsontype === 'Binary') {
        return '<binary>';
      }
      return '{object}';
    }

    return String(value);
  }

  /**
   * Compute basic statistics from documents
   */
  private computeBasicStats(documents: any[]): string[] {
    const stats: string[] = [];

    if (documents.length === 0) return stats;

    // Get numeric fields
    const numericFields: string[] = [];
    const firstDoc = documents[0];
    Object.keys(firstDoc).forEach(key => {
      if (typeof firstDoc[key] === 'number') {
        numericFields.push(key);
      }
    });

    // Compute stats for numeric fields
    numericFields.forEach(field => {
      const values = documents
        .map(doc => doc[field])
        .filter(val => typeof val === 'number' && !isNaN(val));

      if (values.length > 0) {
        const min = Math.min(...values);
        const max = Math.max(...values);
        const avg = values.reduce((a, b) => a + b, 0) / values.length;

        stats.push(`**${field}**: min ${this.formatNumber(min)}, max ${this.formatNumber(max)}, avg ${this.formatNumber(avg)}`);
      }
    });

    // Get string fields for frequency analysis
    const stringFields: string[] = [];
    Object.keys(firstDoc).forEach(key => {
      if (typeof firstDoc[key] === 'string') {
        stringFields.push(key);
      }
    });

    // Top values for string fields
    stringFields.slice(0, 2).forEach(field => {
      const valueCounts: Record<string, number> = {};
      documents.forEach(doc => {
        const value = doc[field];
        if (typeof value === 'string') {
          valueCounts[value] = (valueCounts[value] || 0) + 1;
        }
      });

      const topValues = Object.entries(valueCounts)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 3)
        .map(([value, count]) => `${value} (${count})`);

      if (topValues.length > 0) {
        stats.push(`**${field}** top values: ${topValues.join(', ')}`);
      }
    });

    return stats;
  }

  /**
   * Format numbers with commas
   */
  public formatNumber(num: number): string {
    return num.toLocaleString();
  }
}