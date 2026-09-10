import { TopBar } from "@/components/TopBar";
import { ChatPanel } from "@/components/ChatPanel";

export default async function AiPage({
  searchParams,
}: {
  searchParams: Promise<{ prompt?: string }>;
}) {
  const params = await searchParams;
  return (
    <div className="flex h-screen flex-col">
      <TopBar title="AI Chat" />
      <ChatPanel initialPrompt={params.prompt} />
    </div>
  );
}
