"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

function debounce<T extends (...args: Parameters<T>) => void>(fn: T, delay: number) {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

interface Props {
  initialQuery?: string;
  placeholder?: string;
  className?: string;
}

export default function SearchBar({ initialQuery = "", placeholder = "Search by make, model, city…", className = "" }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

  const fetchSuggestions = useCallback(
    debounce(async (q: string) => {
      if (q.length < 2) { setSuggestions([]); return; }
      try {
        const res = await fetch(`${apiUrl}/search/autocomplete?q=${encodeURIComponent(q)}`);
        if (res.ok) {
          const data = await res.json();
          setSuggestions(data.suggestions ?? []);
          setOpen(true);
        }
      } catch { /* silent */ }
    }, 250),
    [apiUrl]
  );

  useEffect(() => {
    fetchSuggestions(query);
  }, [query, fetchSuggestions]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function submit(q: string) {
    setOpen(false);
    if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open || suggestions.length === 0) {
      if (e.key === "Enter") submit(query);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIdx >= 0) {
        setQuery(suggestions[activeIdx]);
        submit(suggestions[activeIdx]);
      } else {
        submit(query);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIdx(-1);
    }
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="flex rounded-xl border bg-background shadow-sm overflow-hidden">
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder={placeholder}
          onChange={(e) => { setQuery(e.target.value); setActiveIdx(-1); }}
          onKeyDown={handleKeyDown}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          className="flex-1 px-4 py-2.5 text-sm bg-transparent outline-none min-w-0"
          autoComplete="off"
        />
        <button
          type="button"
          onClick={() => submit(query)}
          className="px-4 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
        >
          Search
        </button>
      </div>

      {open && suggestions.length > 0 && (
        <ul className="absolute left-0 right-0 top-full mt-1 z-50 bg-background border rounded-xl shadow-lg overflow-hidden text-sm">
          {suggestions.map((s, i) => (
            <li
              key={s}
              onMouseDown={(e) => { e.preventDefault(); setQuery(s); submit(s); }}
              onMouseEnter={() => setActiveIdx(i)}
              className={`px-4 py-2.5 cursor-pointer transition-colors ${
                i === activeIdx ? "bg-accent text-accent-foreground" : "hover:bg-muted"
              }`}
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
