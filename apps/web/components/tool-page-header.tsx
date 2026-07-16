interface ToolPageHeaderProps {
  eyebrow: string;
  title: string;
  subtitle: string;
  icon?: React.ReactNode;
}

export default function ToolPageHeader({ eyebrow, title, subtitle, icon }: ToolPageHeaderProps) {
  return (
    <section
      style={{ background: "linear-gradient(135deg, oklch(0.12 0.05 255) 0%, oklch(0.18 0.07 255) 100%)" }}
      className="border-b border-white/10"
    >
      <div className="max-w-7xl mx-auto px-4 py-10 md:py-14">
        <div className="flex items-start gap-4">
          {icon && (
            <div className="shrink-0 mt-1 h-10 w-10 rounded-sm bg-accent/15 flex items-center justify-center text-accent">
              {icon}
            </div>
          )}
          <div>
            <span className="text-accent text-xs font-semibold uppercase tracking-[0.2em] block mb-2">
              {eyebrow}
            </span>
            <h1 className="font-display font-semibold text-3xl md:text-4xl text-primary-foreground leading-tight">
              {title}
            </h1>
            <div className="gold-rule mt-3 mb-3" />
            <p className="text-primary-foreground/80 text-sm max-w-xl leading-relaxed">{subtitle}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
