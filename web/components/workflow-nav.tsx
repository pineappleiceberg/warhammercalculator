"use client";

const links = [
  ["/", "Model vs model"],
  ["/unit-vs-unit", "Unit vs unit"],
  ["/lists", "Army lists"],
  ["/play", "Play mode"],
] as const;

export function WorkflowNav({ current }: { current: string }) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return (
    <nav className="workflow-nav" aria-label="Calculator modes">
      {links.map(([href, label]) => (
        <a key={href} href={`${base}${href}`} aria-current={current === href ? "page" : undefined}>
          {label}
        </a>
      ))}
    </nav>
  );
}
