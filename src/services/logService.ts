// filepath: /Users/sunmeng/code/github/mcphub/src/services/logService.ts
import { spawn, ChildProcess } from 'child_process';
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
  bgWhite: '\x1b[47m'
};

// Level colors for different log types
const levelColors = {
  info: colors.green,
  error: colors.red,
  warn: colors.yellow,
  debug: colors.cyan
};

// Maximum number of logs to keep in memory
const MAX_LOGS = 1000;

class LogService {
  private logs: LogEntry[] = [];
  private logEmitter = new EventEmitter();
  private childProcesses: { [id: string]: ChildProcess } = {};
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
  private formatLogMessage(type: 'info' | 'error' | 'warn' | 'debug', source: string, message: string, processId?: string): string {
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

    console.log = (...args: any[]) => {
      const message = args.map(arg => this.formatArgument(arg)).join(' ');
      this.addLog('info', 'main', message);
      originalConsoleLog.apply(console, [this.formatLogMessage('info', 'main', message)]);
    };

    console.error = (...args: any[]) => {
      const message = args.map(arg => this.formatArgument(arg)).join(' ');
      this.addLog('error', 'main', message);
      originalConsoleError.apply(console, [this.formatLogMessage('error', 'main', message)]);
    };

    console.warn = (...args: any[]) => {
      const message = args.map(arg => this.formatArgument(arg)).join(' ');
      this.addLog('warn', 'main', message);
      originalConsoleWarn.apply(console, [this.formatLogMessage('warn', 'main', message)]);
    };

    console.debug = (...args: any[]) => {
      const message = args.map(arg => this.formatArgument(arg)).join(' ');
      this.addLog('debug', 'main', message);
      originalConsoleDebug.apply(console, [this.formatLogMessage('debug', 'main', message)]);
    };
  }

  // Format an argument for logging
  private formatArgument(arg: any): string {
    if (arg === null) return 'null';
    if (arg === undefined) return 'undefined';
    if (typeof arg === 'object') {
      try {
        return JSON.stringify(arg, null, 2);
      } catch (e) {
        return String(arg);
      }
    }
    return String(arg);
  }

  // Add a log entry to the logs array
  private addLog(type: 'info' | 'error' | 'warn' | 'debug', source: string, message: string, processId?: string) {
    const log: LogEntry = {
      timestamp: Date.now(),
      type,
      source,
      message,
      processId: processId || this.mainProcessId
    };

    this.logs.push(log);
    
    // Limit the number of logs kept in memory
    if (this.logs.length > MAX_LOGS) {
      this.logs.shift();
    }
    
    // Emit the log event for SSE subscribers
    this.logEmitter.emit('log', log);
  }

  // Capture output from a child process
  public captureChildProcess(command: string, args: string[], processId: string): ChildProcess {
    const childProcess = spawn(command, args);
    this.childProcesses[processId] = childProcess;

    childProcess.stdout.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        this.addLog('info', 'child-process', output, processId);
        console.log(this.formatLogMessage('info', 'child-process', output, processId));
      }
    });

    childProcess.stderr.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        this.addLog('error', 'child-process', output, processId);
        console.error(this.formatLogMessage('error', 'child-process', output, processId));
      }
    });

    childProcess.on('close', (code) => {
      const message = `Process exited with code ${code}`;
      this.addLog('info', 'child-process', message, processId);
      console.log(this.formatLogMessage('info', 'child-process', message, processId));
      delete this.childProcesses[processId];
    });

    return childProcess;
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