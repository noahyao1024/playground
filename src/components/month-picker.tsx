"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronLeft, ChevronRight, Calendar } from "lucide-react";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface MonthPickerProps {
  value: string; // "YYYY-MM"
  onChange: (value: string) => void;
  placeholder?: string;
}

export function MonthPicker({ value, onChange, placeholder = "Select month" }: MonthPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const parsedYear = value ? parseInt(value.split("-")[0]) : new Date().getFullYear();
  const parsedMonth = value ? parseInt(value.split("-")[1]) - 1 : -1;
  const [viewYear, setViewYear] = useState(parsedYear);

  useEffect(() => {
    if (value) setViewYear(parseInt(value.split("-")[0]));
  }, [value]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function select(monthIndex: number) {
    const m = String(monthIndex + 1).padStart(2, "0");
    onChange(`${viewYear}-${m}`);
    setOpen(false);
  }

  const display = value
    ? `${MONTHS[parsedMonth]} ${parsedYear}`
    : null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <span className={display ? "text-foreground" : "text-muted-foreground"}>
          {display ?? placeholder}
        </span>
        <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute top-full left-0 z-50 mt-1 w-64 rounded-lg border border-border bg-popover p-3 shadow-lg animate-in fade-in-0 zoom-in-95">
          {/* Year nav */}
          <div className="flex items-center justify-between mb-3">
            <button
              type="button"
              onClick={() => setViewYear(viewYear - 1)}
              className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-medium tabular-nums">{viewYear}</span>
            <button
              type="button"
              onClick={() => setViewYear(viewYear + 1)}
              className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* Month grid */}
          <div className="grid grid-cols-3 gap-1">
            {MONTHS.map((month, i) => {
              const isSelected = viewYear === parsedYear && i === parsedMonth;
              return (
                <button
                  key={month}
                  type="button"
                  onClick={() => select(i)}
                  className={`rounded-md px-2 py-1.5 text-sm transition-colors ${
                    isSelected
                      ? "bg-foreground text-background font-medium"
                      : "hover:bg-accent text-foreground"
                  }`}
                >
                  {month}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
