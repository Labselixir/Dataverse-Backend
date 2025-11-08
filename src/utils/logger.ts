import winston from 'winston';
import path from 'path';

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...metadata }) => {
    let msg = `${timestamp} [${level}] : ${message}`;
    if (Object.keys(metadata).length > 0) {
      msg += ` ${JSON.stringify(metadata)}`;
    }
    return msg;
  })
);

export const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: logFormat,
  transports: [
    new winston.transports.Console({
      format: consoleFormat
    })
  ]
});

if (process.env.NODE_ENV === 'production') {
  logger.add(
    new winston.transports.File({
      filename: path.join('logs', 'error.log'),
      level: 'error'
    })
  );
  logger.add(
    new winston.transports.File({
      filename: path.join('logs', 'combined.log')
    })
  );
}

/**
 * Structured Logger for beautiful, readable console output
 */
export class StructuredLogger {
  private context: string;
  private indent: number = 0;

  constructor(context: string) {
    this.context = context;
  }

  section(title: string): void {
    console.log('\n');
    console.log('╔' + '═'.repeat(78) + '╗');
    console.log('║ ' + this.padCenter(title, 76) + ' ║');
    console.log('╚' + '═'.repeat(78) + '╝');
  }

  subsection(title: string): void {
    console.log('\n' + '┌' + '─'.repeat(78) + '┐');
    console.log('│ ' + this.padLeft(title, 76) + ' │');
    console.log('└' + '─'.repeat(78) + '┘');
  }

  info(message: string, data?: any): void {
    const prefix = this.getPrefix('ℹ', '#0066CC');
    const indentStr = '  '.repeat(this.indent);
    console.log(`${indentStr}${prefix} ${message}`);
    if (data) this.logData(data);
    logger.info(`[${this.context}] ${message}`, data);
  }

  success(message: string, data?: any): void {
    const prefix = this.getPrefix('✓', '#00AA00');
    const indentStr = '  '.repeat(this.indent);
    console.log(`${indentStr}${prefix} ${message}`);
    if (data) this.logData(data);
    logger.info(`[${this.context}] SUCCESS: ${message}`, data);
  }

  warn(message: string, data?: any): void {
    const prefix = this.getPrefix('⚠', '#FFAA00');
    const indentStr = '  '.repeat(this.indent);
    console.log(`${indentStr}${prefix} ${message}`);
    if (data) this.logData(data);
    logger.warn(`[${this.context}] ${message}`, data);
  }

  error(message: string, error?: any): void {
    const prefix = this.getPrefix('✗', '#FF0000');
    const indentStr = '  '.repeat(this.indent);
    console.log(`${indentStr}${prefix} ${message}`);
    if (error) {
      if (error instanceof Error) {
        console.log(`${indentStr}  └─ ${error.message}`);
      } else {
        this.logData(error);
      }
    }
    logger.error(`[${this.context}] ${message}`, error);
  }

  debug(message: string, data?: any): void {
    const prefix = this.getPrefix('◆', '#666666');
    const indentStr = '  '.repeat(this.indent);
    console.log(`${indentStr}${prefix} ${message}`);
    if (data) this.logData(data);
    logger.debug(`[${this.context}] ${message}`, data);
  }

  step(stepNumber: number, totalSteps: number, message: string, data?: any): void {
    const progress = `[${stepNumber}/${totalSteps}]`;
    const prefix = this.getPrefix('→', '#0099FF');
    const indentStr = '  '.repeat(this.indent);
    console.log(`${indentStr}${prefix} ${progress} ${message}`);
    if (data) this.logData(data);
    logger.info(`[${this.context}] Step ${stepNumber}/${totalSteps}: ${message}`, data);
  }

  timing(label: string, durationMs: number): void {
    const prefix = this.getPrefix('⏱', '#FF6600');
    const indentStr = '  '.repeat(this.indent);
    const color = durationMs > 1000 ? '#FF0000' : durationMs > 500 ? '#FFAA00' : '#00AA00';
    console.log(`${indentStr}${prefix} ${label}: \x1b[${this.getColorCode(color)}m${durationMs}ms\x1b[0m`);
    logger.info(`[${this.context}] ${label}: ${durationMs}ms`);
  }

  table(data: Record<string, any>): void {
    const indentStr = '  '.repeat(this.indent);
    const entries = Object.entries(data);
    const maxKeyLength = Math.max(...entries.map(([key]) => key.length));

    console.log(`${indentStr}┌─ Details:`);
    entries.forEach(([key, value], index) => {
      const isLast = index === entries.length - 1;
      const connector = isLast ? '└─' : '├─';
      const paddedKey = key.padEnd(maxKeyLength);
      const valueStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
      console.log(`${indentStr}${connector} ${paddedKey}: ${valueStr}`);
    });
  }

  indent_(): void {
    this.indent++;
  }

  dedent(): void {
    if (this.indent > 0) this.indent--;
  }

  child(childContext: string): StructuredLogger {
    const child = new StructuredLogger(`${this.context} > ${childContext}`);
    child.indent = this.indent + 1;
    return child;
  }

  divider(): void {
    console.log('─'.repeat(80));
  }

  separator(): void {
    console.log('\n');
  }

  private getPrefix(icon: string, color: string): string {
    const colorCode = this.getColorCode(color);
    return `\x1b[${colorCode}m${icon}\x1b[0m`;
  }

  private getColorCode(hexColor: string): string {
    const hex = hexColor.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return `38;2;${r};${g};${b}`;
  }

  private padCenter(text: string, width: number): string {
    const padding = Math.max(0, width - text.length);
    const leftPad = Math.floor(padding / 2);
    const rightPad = padding - leftPad;
    return ' '.repeat(leftPad) + text + ' '.repeat(rightPad);
  }

  private padLeft(text: string, width: number): string {
    return text.padEnd(width);
  }

  private logData(data: any): void {
    const indentStr = '  '.repeat(this.indent + 1);
    if (typeof data === 'object') {
      console.log(`${indentStr}${JSON.stringify(data, null, 2).split('\n').join('\n' + indentStr)}`);
    } else {
      console.log(`${indentStr}${data}`);
    }
  }
}

export function createStructuredLogger(context: string): StructuredLogger {
  return new StructuredLogger(context);
}