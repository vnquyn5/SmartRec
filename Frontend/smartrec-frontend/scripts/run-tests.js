import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportDirectory = path.join(projectRoot, "tests", "reports");
const reportPath = path.join(reportDirectory, "latest.md");
const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "smartrec-vitest-"));
const jsonReportPath = path.join(temporaryDirectory, "vitest-report.json");
const vitestCliPath = path.join(
  projectRoot,
  "node_modules",
  "vitest",
  "vitest.mjs",
);
const startedAt = new Date();
let capturedOutput = "";

function formatRunTime(date) {
  return `${new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(date)} (Asia/Ho_Chi_Minh)`;
}

function countAssertions(testFiles) {
  return testFiles.reduce(
    (counts, file) => {
      for (const assertion of file.assertionResults ?? []) {
        counts.total += 1;
        if (assertion.status === "passed") counts.passed += 1;
        else if (assertion.status === "failed") counts.failed += 1;
        else if (assertion.status === "pending" || assertion.status === "skipped") {
          counts.skipped += 1;
        } else if (assertion.status === "todo") counts.todo += 1;
      }
      return counts;
    },
    { total: 0, passed: 0, failed: 0, skipped: 0, todo: 0 },
  );
}

function markdownCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function createMarkdownReport(jsonReport, exitCode, output, errorMessage, durationMs) {
  const testFiles = jsonReport?.testResults ?? [];
  const counts = countAssertions(testFiles);
  const isSuccessful = exitCode === 0 && jsonReport?.success !== false;
  const status = isSuccessful ? "PASSED" : "FAILED";
  const durationSeconds = (durationMs / 1000).toFixed(2);
  const lines = [
    "# Frontend Automation Test Report",
    "",
    `- **Status:** ${status}`,
    `- **Run time:** ${formatRunTime(startedAt)}`,
    `- **Duration:** ${durationSeconds}s`,
    `- **Command:** \`npm test\``,
    "",
    "## Summary",
    "",
    "| Total | Passed | Failed | Skipped | Todo |",
    "|---:|---:|---:|---:|---:|",
    `| ${counts.total} | ${counts.passed} | ${counts.failed} | ${counts.skipped} | ${counts.todo} |`,
    "",
    "## Results by test file",
    "",
    "| Test file | Status | Passed | Failed | Skipped |",
    "|---|---|---:|---:|---:|",
  ];

  if (testFiles.length === 0) {
    lines.push("| No test results were produced | FAILED | 0 | 0 | 0 |");
  } else {
    for (const file of testFiles) {
      const fileCounts = countAssertions([file]);
      const fileStatus =
        file.status === "failed" || fileCounts.failed > 0 ? "FAILED" : "PASSED";
      const relativePath = path.relative(projectRoot, file.name).split(path.sep).join("/");
      lines.push(
        `| \`${markdownCell(relativePath)}\` | ${fileStatus} | ${fileCounts.passed} | ${fileCounts.failed} | ${fileCounts.skipped} |`,
      );
    }
  }

  const failedAssertions = testFiles.flatMap((file) =>
    (file.assertionResults ?? [])
      .filter((assertion) => assertion.status === "failed")
      .map((assertion) => ({ file, assertion })),
  );
  if (failedAssertions.length > 0) {
    lines.push("", "## Failed tests", "");
    for (const { file, assertion } of failedAssertions) {
      const relativePath = path.relative(projectRoot, file.name).split(path.sep).join("/");
      lines.push(`### ${assertion.fullName ?? assertion.title}`);
      lines.push("");
      lines.push(`File: \`${relativePath}\``);
      lines.push("");
      for (const message of assertion.failureMessages ?? []) {
        lines.push("```text", message.trim(), "```", "");
      }
    }
  }

  if (errorMessage) {
    lines.push("", "## Runner error", "", "```text", errorMessage.trim(), "```");
  }

  if (!jsonReport && output.trim()) {
    lines.push("", "## Runner output", "", "```text", output.trim(), "```");
  }

  lines.push(
    "",
    "---",
    "",
    "This report is regenerated automatically whenever `npm test` runs.",
    "",
  );
  return lines.join("\n");
}

async function run() {
  mkdirSync(reportDirectory, { recursive: true });
  const startTime = Date.now();
  let exitCode = 1;
  let errorMessage = "";

  try {
    exitCode = await new Promise((resolve) => {
      const child = spawn(
        process.execPath,
        [
          vitestCliPath,
          "run",
          "--reporter=json",
          "--outputFile",
          jsonReportPath,
        ],
        {
          cwd: projectRoot,
          windowsHide: true,
          stdio: ["inherit", "pipe", "pipe"],
        },
      );

      child.stdout.on("data", (chunk) => {
        const text = chunk.toString();
        capturedOutput += text;
        process.stdout.write(text);
      });
      child.stderr.on("data", (chunk) => {
        const text = chunk.toString();
        capturedOutput += text;
        process.stderr.write(text);
      });
      child.on("error", (error) => {
        errorMessage = error.stack ?? error.message;
        resolve(1);
      });
      child.on("close", (code, signal) => {
        if (signal) {
          errorMessage = `Vitest stopped by signal ${signal}.`;
          resolve(1);
        } else {
          resolve(code ?? 1);
        }
      });
    });
  } catch (error) {
    errorMessage = error.stack ?? String(error);
  } finally {
    let jsonReport = null;
    if (existsSync(jsonReportPath)) {
      try {
        jsonReport = JSON.parse(readFileSync(jsonReportPath, "utf8"));
      } catch (error) {
        errorMessage = [
          errorMessage,
          `Unable to parse Vitest JSON report: ${error.message}`,
        ]
          .filter(Boolean)
          .join("\n");
        exitCode = 1;
      }
    }

    const markdown = createMarkdownReport(
      jsonReport,
      exitCode,
      capturedOutput,
      errorMessage,
      Date.now() - startTime,
    );
    writeFileSync(reportPath, markdown, "utf8");
    rmSync(temporaryDirectory, { recursive: true, force: true });
    console.log(`\nTest report written to ${path.relative(projectRoot, reportPath)}`);
  }

  process.exitCode = exitCode;
}

run();
