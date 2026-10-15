#!/usr/bin/env node
// Native messaging host for the "Ask Opus" button: runs the prompt through the
// local Claude Code CLI (subscription auth), not the API. Chrome spawns this
// once per request and speaks length-prefixed JSON over stdin/stdout:
//   in:  { prompt, system }
//   out: { text } | { error }
// stdout is the protocol channel — never log to it.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Chrome discards the host's stderr, so failures land here instead.
const LOG = path.join(os.tmpdir(), "zehntage-opus-host.log");
const log = (line) => fs.appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`);

function readMessage() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (c) => {
      chunks.push(c);
      const buf = Buffer.concat(chunks);
      if (buf.length < 4) return;
      const len = buf.readUInt32LE(0);
      if (buf.length >= 4 + len) resolve(JSON.parse(buf.subarray(4, 4 + len).toString("utf8")));
    });
    process.stdin.on("end", () => reject(new Error("stdin closed before a full message")));
  });
}

function writeMessage(obj) {
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([head, body]), () => process.exit(0));
}

function runClaude(prompt, system) {
  // No tools, no MCP, no settings files (hooks), no saved session; run from the
  // temp dir so no project CLAUDE.md is picked up. --bare would also strip
  // these but forbids OAuth, i.e. the subscription.
  const args = [
    "-p",
    "--model", "opus",
    "--effort", "high",
    "--tools", "",
    "--strict-mcp-config",
    "--setting-sources", "",
    "--no-session-persistence",
    "--output-format", "json",
    "--system-prompt", system,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, { cwd: os.tmpdir(), stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => {
      let res;
      try {
        res = JSON.parse(out);
      } catch {
        return reject(new Error(`claude exited ${code}: ${(err || out).trim().slice(0, 300)}`));
      }
      if (res.is_error) return reject(new Error(res.result || "claude reported an error"));
      resolve(res.result);
    });
    child.stdin.end(prompt);
  });
}

log(`start pid ${process.pid} argv ${JSON.stringify(process.argv.slice(2))} PATH=${process.env.PATH}`);
try {
  const { prompt, system } = await readMessage();
  writeMessage({ text: await runClaude(prompt, system) });
} catch (e) {
  log(`error: ${e.message}`);
  writeMessage({ error: e.message });
}
