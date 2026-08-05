// Strips comments and collapses whitespace. Punctuation is left alone: spacing
// around `:` and combinators changes what a selector matches.

const WHITESPACE = new Set([" ", "\t", "\n", "\r", "\f"]);

export function minifyCss(css) {
  let out = "";
  let pendingSpace = false;
  let i = 0;

  while (i < css.length) {
    const char = css[i];

    if (char === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? css.length : end + 2;
      pendingSpace = true;
      continue;
    }

    if (WHITESPACE.has(char)) {
      pendingSpace = true;
      i++;
      continue;
    }

    if (pendingSpace) {
      if (out) out += " ";
      pendingSpace = false;
    }

    if (char === '"' || char === "'") {
      let j = i + 1;
      while (j < css.length) {
        if (css[j] === "\\") {
          j += 2;
          continue;
        }
        if (css[j] === char) {
          j++;
          break;
        }
        j++;
      }
      out += css.slice(i, j);
      i = j;
      continue;
    }

    out += char;
    i++;
  }

  return out.trim();
}

export default minifyCss;
