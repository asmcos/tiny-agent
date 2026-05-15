import chalk from "chalk";
import { printPanel, printRule, type UiFormat } from "./ui";

export enum LogLevel {
  OFF = "off",
  ERROR = "error",
  INFO = "info",
  DEBUG = "debug"
}

export class AgentLogger {
  level: LogLevel;
  private readonly uiFormat: UiFormat;

  constructor(level: LogLevel = LogLevel.INFO, uiFormat: UiFormat = "panels") {
    this.level = level;
    this.uiFormat = uiFormat;
  }

  logTask(content: string, title = "Task"): void {
    if (this.uiFormat === "compact") {
      console.log("\n" + "=".repeat(60));
      console.log(chalk.bold(title));
      console.log(content);
      console.log("=".repeat(60) + "\n");
      return;
    }
    console.log("");
    printRule("tiny-agent", "yellow");
    printPanel({ title, body: content, variant: "cyan" });
    console.log("");
  }

  logStep(stepNumber: number, maxSteps: number): void {
    if (this.uiFormat === "compact") {
      console.log(chalk.cyan(`\n--- Step ${stepNumber}/${maxSteps} ---`));
      return;
    }
    printRule(`Step ${stepNumber} / ${maxSteps}`, "cyan");
  }

  logFinalAnswer(answer: string): void {
    if (this.uiFormat === "compact") {
      console.log("\n" + chalk.bold.yellow("Final Answer:"));
      console.log(answer);
      return;
    }
    printRule("Final answer", "yellow");
    printPanel({ title: "Result", body: answer, variant: "yellow" });
  }
}
