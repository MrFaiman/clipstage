import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/85 shadow-xs",
        outline:
          "border border-border bg-background hover:bg-muted text-foreground shadow-xs",
        ghost: "hover:bg-muted text-muted-foreground hover:text-foreground",
        dark: "bg-foreground text-background hover:bg-foreground/90",
        destructive:
          "bg-red-50 text-red-700 hover:bg-red-100 border border-red-200",
      },
      size: {
        default: "h-11 px-4",
        sm: "h-11 px-3 text-xs",
        icon: "size-11",
        lg: "h-12 px-6",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);
export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
