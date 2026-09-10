"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { apiFetch } from "@/lib/csrfClient";
import { VoiceAssistant } from "@/components/VoiceAssistant";

type Message = { role: "user" | "assistant"; content: string };

function getConversationId(): string {
  const key = "pa_conversation_id";
  let id = typeof window !== "undefined" ? localStorage.getItem(key) : null;
  if (!id) {
    id = crypto.randomUUID();
    if (typeof window !== "undefined") localStorage.setItem(key, id);
  }
  return id;
}

export function ChatPanel({ initialPrompt }: { initialPrompt?: string }) {
  const [conversationId] = useState(getConversationId);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentInitialRef = useRef(false);

  useEffect(() => {
    apiFetch(`/api/chat?conversationId=${encodeURIComponent(conversationId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.messages)) {
          setMessages(data.messages.filter((m: Message) => m.content));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (initialPrompt && !sentInitialRef.current) {
          sentInitialRef.current = true;
          void send(initialPrompt);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setError(null);
    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
    setInput("");
    setLoading(true);
    try {
      const res = await apiFetch("/api/chat", {
        method: "POST",
        body: JSON.stringify({ conversationId, message: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply || "(no response)" }]);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void send(input);
  }

  function handleVoiceExchange(exchange: { role: "user" | "assistant"; content: string }[]) {
    setMessages((prev) => [...prev, ...exchange]);
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {voiceOpen && (
        <VoiceAssistant
          conversationId={conversationId}
          onExchange={handleVoiceExchange}
          onClose={() => setVoiceOpen(false)}
        />
      )}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 && !loading && (
          <div className="mt-10 text-center text-sm text-muted">
            <p>This is your personal agent.</p>
            <p className="mt-1">Try: &quot;Summarize my emails&quot; or &quot;Create today&apos;s LinkedIn post&quot;, or tap 🎙 to speak.</p>
          </div>
        )}
        <div className="mx-auto max-w-md space-y-3">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed ${
                  m.role === "user"
                    ? "bg-accent text-accent-foreground"
                    : "border border-border bg-surface text-foreground"
                }`}
              >
                {m.content}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="rounded-2xl border border-border bg-surface px-4 py-2.5 text-sm text-muted">
                Thinking…
              </div>
            </div>
          )}
          {error && (
            <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="mx-auto mb-24 w-full max-w-md shrink-0 px-4 pb-2 safe-bottom"
      >
        <div className="flex items-end gap-2 rounded-2xl border border-border bg-surface p-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={1}
            placeholder="Message your agent…"
            className="max-h-32 min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-[15px] text-foreground outline-none placeholder:text-muted"
          />
          <button
            type="button"
            onClick={() => setVoiceOpen(true)}
            disabled={loading}
            aria-label="Speak"
            className="shrink-0 rounded-xl border border-border px-3.5 py-2.5 text-lg disabled:opacity-40"
          >
            🎙
          </button>
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="shrink-0 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
