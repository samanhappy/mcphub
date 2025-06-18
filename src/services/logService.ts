// filepath: /Users/sunmeng/code/github/mcphub/src/services/logService.ts
import { EventEmitter } from 'events';
import * as os from 'os';
import * as process from 'process';

interface LogEntry {
  timestamp: number;
  type: 'info' | 'error' | 'warn' | 'debug';
  source: string;
  message: string;
  processId?: string;
}

// ANSI color codes for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  underscore: '\x1b[4m',
  blink: '\x1b[5m',
  reverse: '\x1b[7m',
  hidden: '\x1b[8m',

  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',

  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m',
};

// Level colors for different log types
const levelColors = {
  info: colors.green,
  error: colors.red,
  warn: colors.yellow,
  debug: colors.cyan,
};

// Maximum number of logs to keep in memory
const MAX_LOGS = 1000;

class LogService {
  private logs: LogEntry[] = [];
  private logEmitter = new EventEmitter();
  private mainProcessId: string;
  private hostname: string;

  constructor() {
    this.mainProcessId = process.pid.toString();
    this.hostname = os.hostname();
    this.overrideConsole();
  }

  // Format a timestamp for display
  private formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toISOString();
  }

  // Format a log message for console output
  private formatLogMessage(
    type: 'info' | 'error' | 'warn' | 'debug',
    source: string,
    message: string,
    processId?: string,
  ): string {
    const timestamp = this.formatTimestamp(Date.now());
    const pid = processId || this.mainProcessId;
    const level = type.toUpperCase();
    const levelColor = levelColors[type];

    return `${colors.dim}[${timestamp}]${colors.reset} ${levelColor}${colors.bright}[${level}]${colors.reset} ${colors.blue}[${pid}]${colors.reset} ${colors.magenta}[${source}]${colors.reset} ${message}`;
  }

  // Override console methods to capture logs
  private overrideConsole() {
    const originalConsoleLog = console.log;
    const originalConsoleError = console.error;
    const originalConsoleWarn = console.warn;
    const originalConsoleDebug = console.debug;

    // Helper method to handle common logic for all console methods
    const handleConsoleMethod = (
      type: 'info' | 'error' | 'warn' | 'debug',
      originalMethod: (...args: any[]) => void,
      ...args: any[]
    ) => {
      const firstArg = args.length > 0 ? this.formatArgument(args[0]) : { text: '' };
      const remainingArgs = args.slice(1).map((arg) => this.formatArgument(arg).text);
      const combinedMessage = [firstArg.text, ...remainingArgs].join(' ');
      const source = firstArg.source || 'main';
      const processId = firstArg.processId;
      this.addLog(type, source, combinedMessage, processId);
      originalMethod.apply(console, [
        this.formatLogMessage(type, source, combinedMessage, processId),
      ]);
    };

    console.log = (...args: any[]) => {
      handleConsoleMethod('info', originalConsoleLog, ...args);
    };

    console.error = (...args: any[]) => {
      handleConsoleMethod('error', originalConsoleError, ...args);
    };

    console.warn = (...args: any[]) => {
      handleConsoleMethod('warn', originalConsoleWarn, ...args);
    };

    console.debug = (...args: any[]) => {
      handleConsoleMethod('debug', originalConsoleDebug, ...args);
    };
  }

  // Format an argument for logging and extract structured information
  private formatArgument(arg: any): { text: string; source?: string; processId?: string } {
    // Handle null and undefined
    if (arg === null) return { text: 'null' };
    if (arg === undefined) return { text: 'undefined' };

    // Handle objects
    if (typeof arg === 'object') {
      try {
        return { text: JSON.stringify(arg, null, 2) };
      } catch (e) {
        return { text: String(arg) };
      }
    }

    // Handle strings with potential structured information
    const argStr = String(arg);

    // Check for patterns like [processId] [source] message or [processId] [source-processId] message
    const structuredPattern = /^\s*\[([^\]]+)\]\s*\[([^\]]+)\]\s*(.*)/;
    const match = argStr.match(structuredPattern);

    if (match) {
      const [_, firstBracket, secondBracket, remainingText] = match;

      // Check if the second bracket has a format like 'source-processId'
      const sourcePidPattern = /^([^-]+)-(.+)$/;
      const sourcePidMatch = secondBracket.match(sourcePidPattern);

      if (sourcePidMatch) {
        // If we have a 'source-processId' format in the second bracket
        const [_, source, _extractedProcessId] = sourcePidMatch;
        return {
          text: remainingText.trim(),
          source: source.trim(),
          processId: firstBracket.trim(),
        };
      }

      // Otherwise treat first bracket as processId and second as source
      return {
        text: remainingText.trim(),
        source: secondBracket.trim(),
        processId: firstBracket.trim(),
      };
    }

    // Return original string if no structured format is detected
    return { text: argStr };
  }

  // Add a log entry to the logs array
  private addLog(
    type: 'info' | 'error' | 'warn' | 'debug',
    source: string,
    message: string,
    processId?: string,
  ) {
    const log: LogEntry = {
      timestamp: Date.now(),
      type,
      source,
      message,
      processId: processId || this.mainProcessId,
    };

    this.logs.push(log);

    // Limit the number of logs kept in memory
    if (this.logs.length > MAX_LOGS) {
      this.logs.shift();
    }

    // Emit the log event for SSE subscribers
    this.logEmitter.emit('log', log);
  }

  // Get all logs
  public getLogs(): LogEntry[] {
    return this.logs;
  }

  // Subscribe to log events
  public subscribe(callback: (log: LogEntry) => void): () => void {
    this.logEmitter.on('log', callback);
    return () => {
      this.logEmitter.off('log', callback);
    };
  }

  // Clear all logs
  public clearLogs(): void {
    this.logs = [];
    this.logEmitter.emit('clear');
  }
}

// Export a singleton instance
const logService = new LogService();
export default logService;
