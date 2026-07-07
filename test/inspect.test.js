const test = require("node:test");
const assert = require("node:assert/strict");
const { detectFormat, extractPrintableStrings } = require("../src/inspect");

test("detectFormat identifies PE, ELF, Mach-O, and unknown", () => {
  assert.equal(detectFormat(Buffer.from("MZpe")), "pe");
  assert.equal(detectFormat(Buffer.from([0x7f, 0x45, 0x4c, 0x46])), "elf");
  assert.equal(detectFormat(Buffer.from([0xfe, 0xed, 0xfa, 0xcf])), "macho");
  assert.equal(detectFormat(Buffer.from("TEXT")), "unknown");
});

test("extractPrintableStrings returns unique printable strings", () => {
  const result = extractPrintableStrings(Buffer.from("abcd\x00abcd\x00hello world\x00", "latin1"));
  assert.deepEqual(result, ["abcd", "hello world"]);
});
