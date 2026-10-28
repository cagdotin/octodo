import type { ComponentProps, ReactNode } from "react";
import { Button } from "@octodo/ui/components/button";
import { cn } from "@octodo/ui/lib/utils";

/** A property button in the new-task dialog's row: muted until it holds a value. */
export function PropertyChip({
  set = true,
  className,
  children,
  ...props
}: ComponentProps<typeof Button> & { set?: boolean; children: ReactNode }) {
  return (
    <Button
      variant="outline"
      size="xs"
      className={cn("bg-transparent", !set && "text-muted-foreground", className)}
      {...props}
    >
      {children}
    </Button>
  );
}
