"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";

/** A number field that lets you empty it.
 *
 *  Binding a number straight to a controlled input makes the field refuse to
 *  be blank: clearing it sends "", Number("") is 0, the state was already 0,
 *  so React re-renders the same "0" it just removed. Whatever you type next
 *  lands after that zero — the leading zero people keep having to delete.
 *
 *  `value ?? ""` is the usual patch, and it trades the bug for a different
 *  one: a genuine zero becomes invisible, and the field still cannot hold a
 *  half-typed "0." or "-" long enough to finish the number.
 *
 *  So while the field has focus, what you typed is what it shows, kept here
 *  verbatim; the number is reported alongside. Blur drops the draft and the
 *  canonical value takes over, which is what normalises "007" to 7. An empty
 *  field reports `emptyValue` rather than NaN, and input that does not parse
 *  is shown but not reported, so a stray "-" cannot overwrite a good number.
 */
function NumberInput({
  value,
  onValueChange,
  emptyValue = 0,
  onBlur,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "type" | "value" | "onChange"> & {
  value: number;
  onValueChange: (value: number) => void;
  /** Reported when the field is emptied. Default 0. */
  emptyValue?: number;
}) {
  const [draft, setDraft] = React.useState<string | null>(null);

  return (
    <Input
      {...props}
      type="number"
      value={draft ?? (Number.isFinite(value) ? String(value) : "")}
      onChange={(e) => {
        const text = e.target.value;
        setDraft(text);
        if (text === "") {
          onValueChange(emptyValue);
          return;
        }
        const parsed = Number(text);
        // "-", "1e" and friends are mid-typing, not a new value. Leave the
        // last good number in place; the draft keeps them on screen.
        if (!Number.isNaN(parsed)) onValueChange(parsed);
      }}
      onBlur={(e) => {
        setDraft(null);
        onBlur?.(e);
      }}
    />
  );
}

export { NumberInput };
