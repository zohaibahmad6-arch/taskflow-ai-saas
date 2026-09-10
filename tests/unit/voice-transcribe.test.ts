import { describe, test, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { transcribeAudio } from "@/lib/voice/transcribe";
import { getOpenAIClient } from "@/lib/openai";

vi.mock("@/lib/openai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/openai")>();
  return { ...actual, getOpenAIClient: vi.fn() };
});

afterEach(() => {
  vi.mocked(getOpenAIClient).mockReset();
});

function mockTranscriptionResult(text: string | undefined) {
  vi.mocked(getOpenAIClient).mockReturnValue({
    audio: { transcriptions: { create: vi.fn().mockResolvedValue({ text }) } },
  } as unknown as ReturnType<typeof getOpenAIClient>);
}

describe("transcribeAudio", () => {
  test("returns the trimmed transcript on success", async () => {
    mockTranscriptionResult("  Summarize my emails  ");
    const text = await transcribeAudio(Buffer.from("fake audio bytes"), "audio/webm");
    expect(text).toBe("Summarize my emails");
  });

  test("returns an empty string (never throws, never fabricates) when the model returns nothing", async () => {
    mockTranscriptionResult(undefined);
    const text = await transcribeAudio(Buffer.from("fake audio bytes"), "audio/webm");
    expect(text).toBe("");
  });

  test("a transcription API failure propagates as a real error, never a fake success", async () => {
    vi.mocked(getOpenAIClient).mockReturnValue({
      audio: { transcriptions: { create: vi.fn().mockRejectedValue(new Error("upstream failure")) } },
    } as unknown as ReturnType<typeof getOpenAIClient>);
    await expect(transcribeAudio(Buffer.from("x"), "audio/webm")).rejects.toThrow();
  });
});

describe("Voice privacy/security structural checks", () => {
  test("transcribeAudio and the transcribe route never write to the filesystem — audio stays in memory only", () => {
    const files = [
      path.join(process.cwd(), "src/lib/voice/transcribe.ts"),
      path.join(process.cwd(), "src/app/api/voice/transcribe/route.ts"),
    ];
    for (const file of files) {
      const content = fs.readFileSync(file, "utf-8");
      expect(content).not.toMatch(/from ["']node:fs["']|from ["']fs["']|require\(["']fs["']\)|writeFile|createWriteStream|tmpdir/);
    }
  });

  test("the transcribe route's audit events never include the transcript text as event detail", () => {
    const content = fs.readFileSync(path.join(process.cwd(), "src/app/api/voice/transcribe/route.ts"), "utf-8");
    const auditCalls = content.match(/writeAuditEvent\(\{[\s\S]*?\}\);/g) ?? [];
    expect(auditCalls.length).toBeGreaterThan(0);
    for (const call of auditCalls) {
      // The only text-shaped fields allowed are `summary` (a fixed
      // template describing character COUNT, never content) and `error`
      // (a fixed message) — never `detail: text` or similar.
      expect(call).not.toMatch(/detail:\s*text/);
      expect(call).not.toMatch(/detail:\s*\{[^}]*text/);
    }
  });

  test("the voice command route never logs the raw transcribed text either", () => {
    const content = fs.readFileSync(path.join(process.cwd(), "src/app/api/voice/command/route.ts"), "utf-8");
    const auditCalls = content.match(/writeAuditEvent\(\{[\s\S]*?\}\);/g) ?? [];
    for (const call of auditCalls) {
      expect(call).not.toMatch(/detail:\s*parsed\.data\.text|detail:\s*text/);
    }
  });

  test("no API key, secret, or password appears anywhere in the voice feature's source", () => {
    const dirs = [
      path.join(process.cwd(), "src/lib/voice"),
      path.join(process.cwd(), "src/app/api/voice"),
      path.join(process.cwd(), "src/components/VoiceAssistant.tsx"),
      path.join(process.cwd(), "src/hooks/useVoiceRecorder.ts"),
    ];
    const forbidden = /sk-[a-zA-Z0-9]{10,}|NEXT_PUBLIC_OPENAI|process\.env\.OPENAI_API_KEY(?!\s*;?\s*$)/;
    const offenders: string[] = [];
    function scan(target: string) {
      const stat = fs.statSync(target);
      if (stat.isDirectory()) {
        for (const entry of fs.readdirSync(target)) scan(path.join(target, entry));
      } else if (/\.(ts|tsx)$/.test(target)) {
        const content = fs.readFileSync(target, "utf-8");
        if (forbidden.test(content)) offenders.push(target);
        // The API key must never be referenced directly here — only
        // indirectly via getOpenAIClient()/env.openaiApiKey, both
        // server-only and never touched by any client component.
        if (/OPENAI_API_KEY/.test(content) && !target.includes("env.ts")) offenders.push(`${target} (direct env var reference)`);
      }
    }
    for (const dir of dirs) scan(dir);
    expect(offenders).toEqual([]);
  });

  test("VoiceAssistant.tsx and useVoiceRecorder.ts (client code) never import server-only tool/approval internals directly", () => {
    const files = [
      path.join(process.cwd(), "src/components/VoiceAssistant.tsx"),
      path.join(process.cwd(), "src/hooks/useVoiceRecorder.ts"),
    ];
    for (const file of files) {
      const content = fs.readFileSync(file, "utf-8");
      expect(content).not.toMatch(/from ["']@\/lib\/tools|from ["']@\/lib\/approvals|invokeTool|decideApproval/);
    }
  });

  test("tts.ts is structurally output-only: it never imports tools, approvals, or fetch/network machinery — nothing it does can trigger an action", () => {
    const content = fs.readFileSync(path.join(process.cwd(), "src/lib/voice/tts.ts"), "utf-8");
    expect(content).not.toMatch(/invokeTool|decideApproval|fetch\(|XMLHttpRequest|from ["']@\/lib\/tools|from ["']@\/lib\/approvals/);
    // The only browser API it touches is speechSynthesis (read text aloud).
    expect(content).toContain("speechSynthesis");
  });
});
