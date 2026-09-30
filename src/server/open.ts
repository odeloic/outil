import { spawn } from "node:child_process";

export function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url.replace(/&/g, "^&")]]
        : ["xdg-open", [url]];
  const child = spawn(cmd, args, { stdio: "ignore", detached: true });
  // Not fatal: the URL is printed, so the user can open it by hand
  child.on("error", () => {});
  child.unref();
}
