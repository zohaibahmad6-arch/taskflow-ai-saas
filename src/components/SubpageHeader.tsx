import Link from "next/link";

export function SubpageHeader({ title, backHref = "/settings" }: { title: string; backHref?: string }) {
  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background/95 px-4 py-3.5 backdrop-blur safe-top">
      <Link
        href={backHref}
        aria-label="Back"
        className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted active:scale-95"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </Link>
      <h1 className="text-lg font-semibold text-foreground">{title}</h1>
    </header>
  );
}
