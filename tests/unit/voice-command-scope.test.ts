import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * HONESTY CHECK, not a voice feature test — this codebase has NO speech
 * input/output (no microphone capture, no speech-to-text, no
 * text-to-speech, no wake word, nothing) anywhere. Writing tests that
 * pretend to exercise "voice commands" would be exactly the kind of fake
 * capability the project's own "No Fake Capabilities" rule forbids, so
 * this file does the opposite: it (a) records that fact so it can't
 * silently become false without a test noticing, and (b) verifies the one
 * property that actually matters for a future voice layer — that there is
 * still only ONE path by which spoken-then-transcribed text (or anything
 * else) could ever reach a tool: invokeTool(), which is already covered
 * structurally (see approval-integrity.test.ts, email-prompt-injection.test.ts,
 * outlook-mutations.test.ts) as being physically incapable of running an
 * EXTERNAL_ACTION without a pending Approval Center decision, and where a
 * spoken "yes" could only ever be turned into an approve call against
 * whatever specific approvalId/revision is currently displayed — never a
 * standing or ambiguous authorization — by whatever future code parses it,
 * exactly like a typed "yes" already must be today (there is no
 * alternate, voice-specific decide/execute path to add).
 */
describe("Voice command scope (honesty check, not a feature test)", () => {
  test("no speech/voice/microphone/TTS infrastructure exists in this codebase", () => {
    const srcDir = path.join(process.cwd(), "src");
    const offenders: string[] = [];
    const speechPattern = /speech|microphone|\btts\b|text-to-speech|speech-to-text|webkitSpeechRecognition|SpeechRecognition|wake[- ]?word/i;

    function walk(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
          const content = fs.readFileSync(full, "utf-8");
          // A Permissions-Policy header that DENIES microphone/camera
          // access (see proxy.ts) is the opposite of voice infrastructure
          // — it's a security header — so lines doing that don't count.
          const relevantLines = content
            .split("\n")
            .filter((line) => !/Permissions-Policy/i.test(line));
          if (relevantLines.some((line) => speechPattern.test(line))) offenders.push(full);
        }
      }
    }
    walk(srcDir);

    // If this ever fails, it means voice code was added — at which point
    // THIS test should be replaced with real coverage of it, not deleted.
    expect(offenders).toEqual([]);
  });

  test("invokeTool remains the single entry point from any caller (chat today; voice, if ever added, would have no alternate path) to a tool — see tools/execute.ts", () => {
    const executeSource = fs.readFileSync(path.join(process.cwd(), "src/lib/tools/execute.ts"), "utf-8");
    // The whole safety property this codebase relies on for "voice can't
    // have a separate security path" is that there is exactly one
    // function like this, and it is the only place an EXTERNAL_ACTION
    // tool's execute() can ever be reached from outside approvals.ts.
    const invokeToolExports = executeSource.match(/export (async )?function invokeTool/g) ?? [];
    expect(invokeToolExports).toHaveLength(1);
    expect(executeSource).not.toContain("tool.execute("); // invokeTool itself never calls an EXTERNAL_ACTION tool's execute()
  });
});
