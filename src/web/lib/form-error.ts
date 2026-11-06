import type { FieldPath, FieldValues, UseFormSetError } from "react-hook-form";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";

export function showFormError<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly FieldPath<T>[],
): void {
  const message = (error as Error).message;
  const field = error instanceof ApiError ? error.field : undefined;
  if (field && (fields as readonly string[]).includes(field)) {
    setError(field as FieldPath<T>, { message }, { shouldFocus: true });
    return;
  }
  toast.error(message);
}
