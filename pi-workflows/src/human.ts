import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type {
  HumanApproval,
  HumanApproveRequest,
  HumanAskRequest,
  HumanChooseRequest,
  HumanConfirmRequest,
  HumanProvider,
} from "./types.js";

export class HumanInputUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HumanInputUnavailableError";
  }
}

export function defaultHumanProvider(): HumanProvider {
  return new CliHumanProvider();
}

class CliHumanProvider implements HumanProvider {
  async approve(request: HumanApproveRequest): Promise<HumanApproval> {
    const approved = await this.booleanPrompt("approve", request.message, request.default, request.details);
    return { approved };
  }

  async confirm(request: HumanConfirmRequest): Promise<boolean> {
    return this.booleanPrompt("confirm", request.message, request.default, request.details);
  }

  async ask(request: HumanAskRequest): Promise<string> {
    if (!isInteractive()) {
      if (request.default !== undefined) return request.default;
      throw new HumanInputUnavailableError(`Human input required for ${request.id}, but stdin is not interactive and no default was provided.`);
    }

    printDetails(request.details);
    const suffix = request.default !== undefined ? ` [${request.default}]` : "";
    const answer = await askLine(`${request.message}${suffix}: `);
    return answer.trim() || request.default || "";
  }

  async choose<T extends string>(request: HumanChooseRequest<T>): Promise<T> {
    if (request.choices.length === 0) {
      throw new Error(`Human choice request ${request.id} has no choices.`);
    }

    if (!isInteractive()) {
      if (request.default !== undefined) return request.default;
      throw new HumanInputUnavailableError(`Human choice required for ${request.id}, but stdin is not interactive and no default was provided.`);
    }

    printDetails(request.details);
    const choices = request.choices.map((choice, index) => `${index + 1}) ${choice}`).join("\n");
    const suffix = request.default !== undefined ? ` [${request.default}]` : "";

    while (true) {
      const answer = (await askLine(`${request.message}\n${choices}\nChoose${suffix}: `)).trim();
      if (!answer && request.default !== undefined) return request.default;

      const numeric = Number(answer);
      if (Number.isInteger(numeric) && numeric >= 1 && numeric <= request.choices.length) {
        return request.choices[numeric - 1];
      }

      const found = request.choices.find((choice) => choice === answer);
      if (found) return found;
      console.error(`Please choose one of: ${request.choices.join(", ")}`);
    }
  }

  private async booleanPrompt(kind: string, message: string, defaultValue: boolean | undefined, details: unknown): Promise<boolean> {
    if (!isInteractive()) {
      if (defaultValue !== undefined) return defaultValue;
      throw new HumanInputUnavailableError(`Human ${kind} required, but stdin is not interactive and no default was provided.`);
    }

    printDetails(details);
    const suffix = defaultValue === undefined ? " [y/n]" : defaultValue ? " [Y/n]" : " [y/N]";

    while (true) {
      const answer = (await askLine(`${message}${suffix}: `)).trim().toLowerCase();
      if (!answer && defaultValue !== undefined) return defaultValue;
      if (["y", "yes"].includes(answer)) return true;
      if (["n", "no"].includes(answer)) return false;
      console.error("Please answer yes or no.");
    }
  }
}

function isInteractive(): boolean {
  return Boolean(input.isTTY && output.isTTY);
}

async function askLine(question: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

function printDetails(details: unknown): void {
  if (details === undefined) return;
  if (typeof details === "string") {
    console.log(details);
    return;
  }
  console.log(JSON.stringify(details, null, 2));
}
