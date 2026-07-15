interface ToolPageHeaderProps {
  eyebrow: string;
  title: string;
  subtitle: string;
  icon?: React.ReactNode;
}

export default function ToolPageHeader({ eyebrow, title, subtitle, icon }: ToolPageHeaderProps) {
  return (
    <section className="bg-primary text-white">
      <div className="max-w-7xl mx-auto px-4 py-10 md:py-14">
        <div className="flex items-start gap-5">
          {icon && (
            <div className="shrink-0 mt-1 h-12 w-12 rounded-xl bg-white/10 flex items-center justify-center">
              {icon}
            </div>
          )}
          <div>
            <span className="text-accent text-xs font-semibold uppercase tracking-widest block mb-2">
              {eyebrow}
            </span>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">{title}</h1>
            <p className="text-white/65 mt-2 max-w-xl text-base">{subtitle}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
