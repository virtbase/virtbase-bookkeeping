export function openCommand(
  target: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  return [platform === "darwin" ? "open" : "xdg-open", target];
}
