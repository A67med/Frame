import type { ReactNode } from "react";

export function PageHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="frame-page-heading">
      <div className="frame-page-heading-copy">
        {eyebrow && <span className="frame-eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <div className="frame-page-description">{description}</div>}
      </div>
      {actions && <div className="frame-page-actions">{actions}</div>}
    </header>
  );
}
