import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error - plain JS module without type declarations
import { minifyCss } from "./css-minify.js";

const stylesheet = () =>
  readFileSync(
    join(import.meta.dirname, "..", "src", "bitcoin-pay.css"),
    "utf8"
  );

describe("minifyCss", () => {
  it("strips comments and collapses whitespace", () => {
    expect(minifyCss(`/* header */\n.a {\n  color: red;\n}\n`)).toBe(
      ".a { color: red; }"
    );
  });

  it("keeps the space before a descendant :where()", () => {
    // Dropping it turns a descendant combinator into a compound selector,
    // which matches completely different elements
    const input = `html[data-theme="dark"] :where(.widget) { color: red; }`;
    expect(minifyCss(input)).toBe(
      `html[data-theme="dark"] :where(.widget) { color: red; }`
    );
  });

  it("does not join or split a compound selector", () => {
    expect(minifyCss(`a:hover { color: red; }`)).toBe("a:hover { color: red; }");
    expect(minifyCss(`a :hover { color: red; }`)).toBe(
      "a :hover { color: red; }"
    );
  });

  it("preserves combinators", () => {
    expect(minifyCss(`.a > .b { c: d; }`)).toBe(".a > .b { c: d; }");
    expect(minifyCss(`.a + .b { c: d; }`)).toBe(".a + .b { c: d; }");
  });

  it("leaves string contents untouched", () => {
    expect(minifyCss(`.a { font-family: "Segoe  UI", sans-serif; }`)).toBe(
      `.a { font-family: "Segoe  UI", sans-serif; }`
    );
  });

  it("does not strip a comment inside a string", () => {
    expect(minifyCss(`.a::after { content: "/* not a comment */"; }`)).toBe(
      `.a::after { content: "/* not a comment */"; }`
    );
  });

  it("keeps significant spaces in multi-value declarations", () => {
    expect(minifyCss(`.a { margin: 0   auto; }`)).toBe(".a { margin: 0 auto; }");
  });

  it("handles at-rules", () => {
    const input = `@media (prefers-color-scheme: dark) {\n  .a { color: red; }\n}`;
    expect(minifyCss(input)).toBe(
      "@media (prefers-color-scheme: dark) { .a { color: red; } }"
    );
  });

  it("is idempotent", () => {
    const once = minifyCss(stylesheet());
    expect(minifyCss(once)).toBe(once);
  });

  it("preserves brace balance on the real stylesheet", () => {
    const css = stylesheet();
    const minified = minifyCss(css);
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const count = (s: string, c: string) => s.split(c).length - 1;

    expect(count(minified, "{")).toBe(count(withoutComments, "{"));
    expect(count(minified, "}")).toBe(count(withoutComments, "}"));
    expect(count(minified, ";")).toBe(count(withoutComments, ";"));
    expect(minified).not.toContain("/*");
    expect(minified).not.toContain("\n");
    expect(minified.length).toBeLessThan(css.length);
  });
});
