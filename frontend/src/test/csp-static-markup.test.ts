import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("static markup CSP compatibility", () => {
  it("loads hosted fonts without inline event handlers", async () => {
    const frontendRoot = path.resolve(process.cwd());
    const [html, securityHeaders] = await Promise.all([
      readFile(path.join(frontendRoot, "index.html"), "utf8"),
      readFile(path.join(frontendRoot, "security-headers.conf"), "utf8"),
    ]);

    expect(securityHeaders).toContain("script-src 'self'");
    expect(securityHeaders).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(securityHeaders).toContain(
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    );
    expect(securityHeaders).toContain("font-src 'self' data: https:");

    const document = new DOMParser().parseFromString(html, "text/html");
    const googleFontStylesheets = [
      ...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
    ].filter((link) =>
      link.getAttribute("href")?.startsWith(
        "https://fonts.googleapis.com/css2?",
      ),
    );
    expect(googleFontStylesheets).toHaveLength(1);
    expect(googleFontStylesheets[0]?.getAttribute("media")).not.toBe("print");
    expect(googleFontStylesheets[0]?.hasAttribute("onload")).toBe(false);

    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
  });
});
