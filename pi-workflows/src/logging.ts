import type { PhaseLog, WorkflowLogger } from "./types.js";

function now() {
  return new Date().toISOString().slice(11, 19);
}

function format(label: string, message: string) {
  return `[${now()}] ${label.padEnd(8)} ${message}`;
}

export class ConsoleWorkflowLogger implements WorkflowLogger {
  phase(name: string): void {
    console.log(`\n=== ${name.toUpperCase()} ===\n`);
  }

  start(phase: string, message?: string): void {
    console.log(format("start", message ? `${phase}: ${message}` : phase));
  }

  info(phaseOrMessage: string, message?: string): void {
    console.log(format("info", message ? `${phaseOrMessage}: ${message}` : phaseOrMessage));
  }

  success(phaseOrMessage: string, message?: string): void {
    console.log(format("success", message ? `${phaseOrMessage}: ${message}` : phaseOrMessage));
  }

  warn(phaseOrMessage: string, message?: string): void {
    console.warn(format("warn", message ? `${phaseOrMessage}: ${message}` : phaseOrMessage));
  }

  error(phaseOrMessage: string, message?: string): void {
    console.error(format("error", message ? `${phaseOrMessage}: ${message}` : phaseOrMessage));
  }

  stepStart(kind: string, name: string): void {
    console.log(format(kind, `→ ${name}`));
  }

  stepEnd(kind: string, name: string): void {
    console.log(format(kind, `✓ ${name}`));
  }
}

export class LoggerPhaseLog implements PhaseLog {
  constructor(private readonly logger: WorkflowLogger) {}

  start(phase: string, message?: string): void {
    this.logger.start?.(phase, message);
  }

  info(phaseOrMessage: string, message?: string): void {
    this.logger.info?.(phaseOrMessage, message);
  }

  success(phaseOrMessage: string, message?: string): void {
    this.logger.success?.(phaseOrMessage, message);
  }

  warn(phaseOrMessage: string, message?: string): void {
    this.logger.warn?.(phaseOrMessage, message);
  }

  error(phaseOrMessage: string, message?: string): void {
    this.logger.error?.(phaseOrMessage, message);
  }
}
