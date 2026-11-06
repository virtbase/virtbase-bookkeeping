export function neutralizeField(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

export function quoteField(field: string): string {
  return /[;"\r\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field;
}
