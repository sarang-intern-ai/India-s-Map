import type { ReactNode } from 'react';

/** A titled block within the panel. Kept tiny and reusable so sections stay consistent. */
export function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="px-4 py-3">
      <div className="mb-2 flex items-center justify-between border-b border-ink-200 pb-1.5">
        <h3 className="text-[11px] font-semibold tracking-wider text-brand-700 uppercase">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}
