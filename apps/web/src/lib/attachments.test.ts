import { describe, expect, it } from "vitest";
import { attachmentName, attachmentUrl, imageMarkdown } from "./attachments.ts";

const BASE = "/api/workspaces/hm/tasks/HM-1/files";

describe("attachments", () => {
  it("loads paths in the task folder through the server", () => {
    expect(attachmentUrl(BASE, "images/plan.png")).toBe(`${BASE}/images/plan.png`);
    expect(attachmentUrl(BASE, "./images/plan.png")).toBe(`${BASE}/images/plan.png`);
  });

  it("leaves everything outside the task folder as source, web images included", () => {
    for (const src of [
      "https://example.com/a.png",
      "HTTP://example.com/a.png",
      "//example.com/a.png",
      "../task.md",
      "images/../../x",
      "images/%2e%2e/%2E%2E/x",
      "/api/workspaces",
      "\\\\host\\share",
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      ".hidden.png",
      "",
    ]) {
      expect({ src, url: attachmentUrl(BASE, src) }).toEqual({ src, url: null });
    }
  });

  it("names an upload so its markdown link needs no escaping", () => {
    expect(attachmentName({ name: "Screen Shot 1.PNG", type: "image/png" })).toBe(
      "screen-shot-1.png",
    );
    expect(attachmentName({ name: "", type: "image/jpeg" })).toBe("image.jpg");
    expect(imageMarkdown("images/screen-shot-1.png")).toBe("![](images/screen-shot-1.png)");
    expect(imageMarkdown("images/a b.png")).toBe("![](<images/a b.png>)");
  });
});
