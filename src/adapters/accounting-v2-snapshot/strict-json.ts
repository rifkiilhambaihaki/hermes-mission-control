export class DuplicateJsonKeyError extends Error {}

class JsonCursor {
  readonly #text: string;
  #index = 0;

  constructor(text: string) {
    this.#text = text;
  }

  parse(): void {
    this.#skipWhitespace();
    this.#parseValue();
    this.#skipWhitespace();
    if (this.#index !== this.#text.length) throw new SyntaxError("trailing JSON input");
  }

  #skipWhitespace(): void {
    while (/\s/.test(this.#text[this.#index] ?? "")) this.#index += 1;
  }

  #parseValue(): void {
    this.#skipWhitespace();
    const character = this.#text[this.#index];
    if (character === "{") return this.#parseObject();
    if (character === "[") return this.#parseArray();
    if (character === '"') {
      this.#parseString();
      return;
    }
    for (const literal of ["true", "false", "null"]) {
      if (this.#text.startsWith(literal, this.#index)) {
        this.#index += literal.length;
        return;
      }
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(this.#text.slice(this.#index));
    if (number === null) throw new SyntaxError("invalid JSON value");
    this.#index += number[0].length;
  }

  #parseObject(): void {
    this.#index += 1;
    this.#skipWhitespace();
    const keys = new Set<string>();
    if (this.#text[this.#index] === "}") {
      this.#index += 1;
      return;
    }
    while (true) {
      this.#skipWhitespace();
      if (this.#text[this.#index] !== '"') throw new SyntaxError("object key required");
      const key = this.#parseString();
      if (keys.has(key)) throw new DuplicateJsonKeyError("duplicate JSON object key");
      keys.add(key);
      this.#skipWhitespace();
      if (this.#text[this.#index] !== ":") throw new SyntaxError("object colon required");
      this.#index += 1;
      this.#parseValue();
      this.#skipWhitespace();
      const separator = this.#text[this.#index];
      if (separator === "}") {
        this.#index += 1;
        return;
      }
      if (separator !== ",") throw new SyntaxError("object separator required");
      this.#index += 1;
    }
  }

  #parseArray(): void {
    this.#index += 1;
    this.#skipWhitespace();
    if (this.#text[this.#index] === "]") {
      this.#index += 1;
      return;
    }
    while (true) {
      this.#parseValue();
      this.#skipWhitespace();
      const separator = this.#text[this.#index];
      if (separator === "]") {
        this.#index += 1;
        return;
      }
      if (separator !== ",") throw new SyntaxError("array separator required");
      this.#index += 1;
    }
  }

  #parseString(): string {
    const start = this.#index;
    this.#index += 1;
    while (this.#index < this.#text.length) {
      const character = this.#text[this.#index];
      if (character === '"') {
        this.#index += 1;
        return JSON.parse(this.#text.slice(start, this.#index)) as string;
      }
      if (character === "\\") {
        this.#index += 1;
        const escape = this.#text[this.#index];
        if (escape === "u") {
          const hex = this.#text.slice(this.#index + 1, this.#index + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new SyntaxError("invalid Unicode escape");
          this.#index += 5;
          continue;
        }
        if (!['"', "\\", "/", "b", "f", "n", "r", "t"].includes(escape ?? "")) {
          throw new SyntaxError("invalid JSON escape");
        }
        this.#index += 1;
        continue;
      }
      if (character === undefined || character.charCodeAt(0) < 0x20) {
        throw new SyntaxError("invalid JSON string");
      }
      this.#index += 1;
    }
    throw new SyntaxError("unterminated JSON string");
  }
}

export function parseStrictJson(text: string): unknown {
  new JsonCursor(text).parse();
  return JSON.parse(text) as unknown;
}
