#!/usr/bin/env node

/**
 * Trends Factory - Cross-Platform Setup Script
 * Run: node setup.js
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question) {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

function checkCommand(cmd) {
  try {
    execSync(`${cmd} --version`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log("");
  console.log("====================================");
  console.log("  TRENDS FACTORY - Setup Wizard");
  console.log("====================================");
  console.log("");

  // Check Node.js version
  const nodeVersion = process.version;
  const majorVersion = parseInt(nodeVersion.slice(1).split(".")[0], 10);

  console.log(`Checking Node.js... ${nodeVersion}`);
  if (majorVersion < 20) {
    console.error("  ERROR: Node.js 20+ required");
    process.exit(1);
  }
  console.log("  OK");

  // Check FFmpeg
  console.log("Checking FFmpeg...");
  if (checkCommand("ffmpeg")) {
    console.log("  OK");
  } else {
    console.log("  WARNING: FFmpeg not found");
    console.log("  Install from: https://ffmpeg.org/download.html");
    console.log("  The pipeline will fail at video assembly without FFmpeg.");
  }

  // Setup .env file
  console.log("");
  const envPath = path.join(__dirname, ".env");

  if (fs.existsSync(envPath)) {
    console.log(".env file already exists.");
    const overwrite = await ask("Overwrite? (y/N): ");
    if (overwrite.toLowerCase() !== "y") {
      console.log("Keeping existing .env file");
    } else {
      fs.unlinkSync(envPath);
    }
  }

  if (!fs.existsSync(envPath)) {
    console.log("");
    console.log("Enter your Gemini API Key:");
    console.log("(Get one at https://aistudio.google.com/app/apikey)");
    const apiKey = await ask("API Key: ");

    if (!apiKey || !apiKey.trim()) {
      console.error("ERROR: API key cannot be empty");
      process.exit(1);
    }

    // Write .env file - NO QUOTES around the value
    const envContent = `GEMINI_API_KEY=${apiKey.trim()}\n`;
    fs.writeFileSync(envPath, envContent, "utf8");

    console.log(".env file created successfully");
  }

  // Install dependencies
  console.log("");
  console.log("Installing dependencies...");
  try {
    execSync("npm install", { cwd: __dirname, stdio: "inherit" });
    console.log("Dependencies installed");
  } catch (error) {
    console.error("ERROR: npm install failed");
    process.exit(1);
  }

  // Done
  console.log("");
  console.log("====================================");
  console.log("  Setup Complete!");
  console.log("====================================");
  console.log("");
  console.log("Run the pipeline with:");
  console.log("  npm run generate");
  console.log("");

  rl.close();
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
