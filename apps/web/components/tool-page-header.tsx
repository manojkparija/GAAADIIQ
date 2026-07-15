interface ToolPageHeaderProps {
  eyebrow: string;
  title: string;
  subtitle: string;
  icon?: React.ReactNode;
}

export default function ToolPageHeader({ eyebrow, title, subtitle, icon }: ToolPageHeaderProps) {
  return (
    <section className="bg-[#f7f7f7] border-b">
      <div className="max-w-7xl mx-auto px-4 py-8 md:py-10">
        <div className="flex items-start gap-4">
          {icon && (
            <div className="shrink-0 mt-1 h-10 w-10 rounded-lg bg-[#F15B22]/10 flex items-center justify-center text-[#F15B22]">
              {icon}
            </div>
          )}
          <div>
            <span className="text-[#F15B22] text-xs font-semibold uppercase tracking-widest block mb-1.5">
              {eyebrow}
            </span>
            <h1 className="text-2xl md:text-3xl font-bold text-[#111] tracking-tight">{title}</h1>
            <p className="text-gray-500 mt-1.5 max-w-xl text-sm">{subtitle}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
