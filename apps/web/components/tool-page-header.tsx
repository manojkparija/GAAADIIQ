interface ToolPageHeaderProps {
  eyebrow: string;
  title: string;
  subtitle: string;
  icon?: React.ReactNode;
}

export default function ToolPageHeader({ eyebrow, title, subtitle, icon }: ToolPageHeaderProps) {
  return (
    <section className="hero-navy border-b border-accent/20">
      <div className="max-w-7xl mx-auto px-4 py-12 md:py-16">
        <div className="flex items-start gap-5">
          {icon && (
            <div className="shrink-0 mt-1.5 h-11 w-11 border border-accent/40 bg-accent/10 flex items-center justify-center text-accent">
              {icon}
            </div>
          )}
          <div>
            <span className="text-accent text-[11px] font-semibold uppercase tracking-[0.24em] block mb-3">
              {eyebrow}
            </span>
            <h1 className="font-display font-semibold text-3xl md:text-5xl text-primary-foreground leading-[1.15] tracking-tight">
              {title}
            </h1>
            <div className="gold-rule-lg anim-rule mt-4 mb-4" />
            <p className="text-primary-foreground/70 text-sm md:text-base max-w-xl leading-relaxed font-light">
              {subtitle}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
