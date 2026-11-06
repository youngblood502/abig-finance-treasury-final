"use client";
import * as React from "react";
import { useFormStatus } from "react-dom";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

/** A form's button. It locks with a spinner while the request is on its way, so nothing is sent twice. */
export function SubmitButton({ children, disabled, ...props }: React.ComponentProps<typeof Button>) {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending || disabled} {...props}>{pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}{children}</Button>;
}
