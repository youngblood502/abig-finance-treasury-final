import * as React from "react";

/** The top of every rebuilt screen: its title, one line of purpose, and its main button. */
export function PageHeader({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <div data-slot="page-header" className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="m-0 text-2xl font-bold tracking-tight">{title}</h1>
        <p className="m-0 mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
