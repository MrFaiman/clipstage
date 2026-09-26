import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
const fieldClass =
  "w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm shadow-xs outline-none placeholder:text-muted-foreground/70 focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:opacity-50";
export function Input(props: ComponentProps<"input">) {
  return <input {...props} className={cn(fieldClass, props.className)} />;
}
export function Textarea(props: ComponentProps<"textarea">) {
  return (
    <textarea
      {...props}
      className={cn(fieldClass, "min-h-28 resize-y", props.className)}
    />
  );
}
export function Select(props: ComponentProps<"select">) {
  return (
    <select
      {...props}
      className={cn(fieldClass, "h-10 py-0", props.className)}
    />
  );
}
export function Label(props: ComponentProps<"label">) {
  return (
    <label
      {...props}
      className={cn(
        "mb-2 block text-xs font-semibold text-foreground",
        props.className,
      )}
    />
  );
}
