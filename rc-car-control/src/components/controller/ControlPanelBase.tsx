import type { ReactNode } from "react";

interface ControlPanelBaseProps {
  title: string;
  badge?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  titleClassName?: string;
  headerClassName?: string;
}

function joinClassNames(...classNames: Array<string | undefined>) {
  return classNames.filter(Boolean).join(" ");
}

const panelBaseClassName =
  "rounded-3xl glass-surface desktop-glass-surface p-3 transition-shadow duration-200 hover:shadow-lg";

const infoCardClassName = "rounded-xl glass-chip desktop-glass-chip p-2.5";

interface ControlPanelInfoCardProps {
  title: string;
  children: ReactNode;
  className?: string;
}

export function ControlPanelInfoCard({
  title,
  children,
  className,
}: ControlPanelInfoCardProps) {
  return (
    <div className={joinClassNames(infoCardClassName, "min-w-0", className)}>
      <p className="text-[11px] text-slate-400" style={{ overflowWrap: "anywhere" }}>
        {title}
      </p>
      {children}
    </div>
  );
}

export default function ControlPanelBase({
  title,
  badge,
  children,
  className,
  contentClassName,
  titleClassName,
  headerClassName,
}: ControlPanelBaseProps) {
  return (
    <section className={joinClassNames(panelBaseClassName, className)}>
      <div
        className={joinClassNames(
          "mb-2 flex items-center justify-between",
          headerClassName
        )}
      >
        <h2 className={joinClassNames("font-semibold text-slate-900", titleClassName)}>
          {title}
        </h2>
        {badge}
      </div>

      <div className={contentClassName}>{children}</div>
    </section>
  );
}
