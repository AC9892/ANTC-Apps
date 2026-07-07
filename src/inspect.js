const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const MAX_IN_MEMORY_FILE_BYTES = 2147483647;
const MAX_STRING_RESULTS = 200;
const MAX_STRING_SCAN_BYTES = 4 * 1024 * 1024;

function requireFilePath(filePath) {
  if (filePath === undefined || filePath === null || String(filePath).trim() === "") {
    throw new Error("Input path is required.");
  }

  return path.resolve(String(filePath).trim());
}

function readFileInfo(filePath, options = {}) {
  const resolvedPath = requireFilePath(filePath);
  const stats = fs.statSync(resolvedPath);

  if (!stats.isFile()) {
    throw new Error(`Input path "${resolvedPath}" must be a regular file.`);
  }

  if (stats.size > MAX_IN_MEMORY_FILE_BYTES && options.allowLargeFiles !== true) {
    throw new Error(`Input path "${resolvedPath}" is over the 2 GB in-memory safety limit.`);
  }

  const bytes = fs.readFileSync(resolvedPath);
  return { resolvedPath, stats, bytes };
}

function readUInt64LE(buffer, offset) {
  return Number(buffer.readBigUInt64LE(offset));
}

function readUInt64BE(buffer, offset) {
  return Number(buffer.readBigUInt64BE(offset));
}

function sha(buffer, algorithm) {
  return crypto.createHash(algorithm).update(buffer).digest("hex");
}

function entropy(buffer) {
  if (buffer.length === 0) {
    return 0;
  }

  const counts = new Uint32Array(256);
  for (const byte of buffer) {
    counts[byte] += 1;
  }

  let value = 0;
  for (const count of counts) {
    if (count === 0) {
      continue;
    }
    const p = count / buffer.length;
    value -= p * Math.log2(p);
  }
  return Number(value.toFixed(4));
}

function extractPrintableStrings(buffer, limit = MAX_STRING_RESULTS) {
  const source = buffer.subarray(0, Math.min(buffer.length, MAX_STRING_SCAN_BYTES));
  const matches = source.toString("latin1").match(/[\x20-\x7e]{4,}/g) ?? [];
  const unique = [];
  const seen = new Set();

  for (const value of matches) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    unique.push(value);
    if (unique.length >= limit) {
      break;
    }
  }

  return unique;
}

function machineTypeName(machine) {
  const names = {
    0x014c: "x86",
    0x8664: "x64",
    0x01c0: "ARM",
    0xaa64: "ARM64"
  };
  return names[machine] ?? `0x${machine.toString(16)}`;
}

function peSubsystemName(value) {
  const names = {
    1: "Native",
    2: "Windows GUI",
    3: "Windows CUI",
    9: "Windows CE GUI",
    10: "EFI Application",
    11: "EFI Boot Service Driver",
    12: "EFI Runtime Driver",
    13: "EFI ROM",
    14: "Xbox",
    16: "Windows Boot Application"
  };
  return names[value] ?? String(value);
}

function detectFormat(buffer) {
  if (buffer.length >= 2 && buffer.subarray(0, 2).toString("ascii") === "MZ") {
    return "pe";
  }
  if (buffer.length >= 4 && buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46) {
    return "elf";
  }
  if (buffer.length >= 4) {
    const magic = buffer.readUInt32BE(0);
    if ([0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe].includes(magic)) {
      return "macho";
    }
  }
  return "unknown";
}

function inspectPe(buffer) {
  if (buffer.length < 0x40) {
    throw new Error("PE file is too small.");
  }

  const peOffset = buffer.readUInt32LE(0x3c);
  if (peOffset + 24 > buffer.length) {
    throw new Error("PE header offset is outside the file.");
  }
  if (buffer.subarray(peOffset, peOffset + 4).toString("ascii") !== "PE\u0000\u0000") {
    throw new Error("PE signature not found.");
  }

  const machine = buffer.readUInt16LE(peOffset + 4);
  const sectionCount = buffer.readUInt16LE(peOffset + 6);
  const timestamp = buffer.readUInt32LE(peOffset + 8);
  const optionalHeaderSize = buffer.readUInt16LE(peOffset + 20);
  const optionalStart = peOffset + 24;
  const optionalMagic = buffer.readUInt16LE(optionalStart);
  const isPe32Plus = optionalMagic === 0x20b;
  const entryPoint = buffer.readUInt32LE(optionalStart + 16);
  const imageBase = isPe32Plus
    ? readUInt64LE(buffer, optionalStart + 24)
    : buffer.readUInt32LE(optionalStart + 28);
  const subsystemOffset = isPe32Plus ? optionalStart + 68 : optionalStart + 68;
  const subsystem = buffer.readUInt16LE(subsystemOffset);
  const sectionStart = optionalStart + optionalHeaderSize;
  const sections = [];

  for (let index = 0; index < sectionCount; index += 1) {
    const offset = sectionStart + index * 40;
    if (offset + 40 > buffer.length) {
      break;
    }

    const name = buffer.subarray(offset, offset + 8).toString("ascii").replace(/\0+$/, "");
    sections.push({
      name,
      virtualSize: buffer.readUInt32LE(offset + 8),
      virtualAddress: `0x${buffer.readUInt32LE(offset + 12).toString(16)}`,
      rawSize: buffer.readUInt32LE(offset + 16),
      rawOffset: `0x${buffer.readUInt32LE(offset + 20).toString(16)}`
    });
  }

  return {
    format: "PE",
    architecture: machineTypeName(machine),
    machine: `0x${machine.toString(16)}`,
    entryPoint: `0x${entryPoint.toString(16)}`,
    imageBase: `0x${imageBase.toString(16)}`,
    subsystem: peSubsystemName(subsystem),
    sectionCount,
    timestampUtc: new Date(timestamp * 1000).toISOString(),
    sections
  };
}

function elfMachineName(machine) {
  const names = {
    0x03: "x86",
    0x3e: "x64",
    0x28: "ARM",
    0xb7: "ARM64"
  };
  return names[machine] ?? `0x${machine.toString(16)}`;
}

function inspectElf(buffer) {
  if (buffer.length < 0x34) {
    throw new Error("ELF file is too small.");
  }

  const is64 = buffer[4] === 2;
  const isLe = buffer[5] === 1;
  const readUInt16 = (offset) => (isLe ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset));
  const readUInt32 = (offset) => (isLe ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset));
  const readWord = (offset) => (is64 ? (isLe ? readUInt64LE(buffer, offset) : readUInt64BE(buffer, offset)) : readUInt32(offset));
  const eMachine = readUInt16(18);
  const entry = readWord(24);
  const shoff = readWord(is64 ? 40 : 32);
  const shentsize = readUInt16(is64 ? 58 : 46);
  const shnum = readUInt16(is64 ? 60 : 48);
  const shstrndx = readUInt16(is64 ? 62 : 50);
  const sections = [];

  let stringTable = Buffer.alloc(0);
  if (shoff > 0 && shentsize > 0 && shstrndx < shnum) {
    const strHeaderOffset = shoff + shstrndx * shentsize;
    if (strHeaderOffset + shentsize <= buffer.length) {
      const strOffset = readWord(strHeaderOffset + (is64 ? 24 : 16));
      const strSize = readWord(strHeaderOffset + (is64 ? 32 : 20));
      if (strOffset + strSize <= buffer.length) {
        stringTable = buffer.subarray(strOffset, strOffset + strSize);
      }
    }
  }

  for (let index = 0; index < shnum; index += 1) {
    const offset = shoff + index * shentsize;
    if (offset + shentsize > buffer.length) {
      break;
    }

    const nameOffset = readUInt32(offset);
    let end = nameOffset;
    while (end < stringTable.length && stringTable[end] !== 0) {
      end += 1;
    }
    sections.push({
      name: stringTable.length > nameOffset ? stringTable.subarray(nameOffset, end).toString("utf8") : "",
      type: `0x${readUInt32(offset + 4).toString(16)}`,
      address: `0x${readWord(offset + (is64 ? 16 : 12)).toString(16)}`,
      offset: `0x${readWord(offset + (is64 ? 24 : 16)).toString(16)}`,
      size: readWord(offset + (is64 ? 32 : 20))
    });
  }

  return {
    format: "ELF",
    architecture: elfMachineName(eMachine),
    class: is64 ? "ELF64" : "ELF32",
    endianness: isLe ? "Little Endian" : "Big Endian",
    entryPoint: `0x${entry.toString(16)}`,
    sectionCount: shnum,
    sections
  };
}

function machoCpuName(cpuType) {
  const names = {
    7: "x86",
    0x01000007: "x64",
    12: "ARM",
    0x0100000c: "ARM64"
  };
  return names[cpuType >>> 0] ?? `0x${(cpuType >>> 0).toString(16)}`;
}

function inspectMachO(buffer) {
  if (buffer.length < 32) {
    throw new Error("Mach-O file is too small.");
  }

  const magic = buffer.readUInt32BE(0);
  const is64 = magic === 0xfeedfacf || magic === 0xcffaedfe;
  const isLe = magic === 0xcefaedfe || magic === 0xcffaedfe;
  const readUInt32 = (offset) => (isLe ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset));
  const cpuType = readUInt32(4);
  const commandCount = readUInt32(16);
  const commandsSize = readUInt32(20);
  let offset = is64 ? 32 : 28;
  const sections = [];

  for (let index = 0; index < commandCount && offset + 8 <= buffer.length; index += 1) {
    const cmd = readUInt32(offset);
    const cmdSize = readUInt32(offset + 4);
    if (cmdSize <= 0 || offset + cmdSize > buffer.length) {
      break;
    }

    const isSegment = cmd === 0x1 || cmd === 0x19;
    if (isSegment) {
      const sectionCount = readUInt32(offset + (cmd === 0x19 ? 64 : 48));
      let sectionOffset = offset + (cmd === 0x19 ? 72 : 56);
      const sectionSize = cmd === 0x19 ? 80 : 68;

      for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex += 1) {
        if (sectionOffset + sectionSize > buffer.length) {
          break;
        }
        sections.push({
          name: buffer.subarray(sectionOffset, sectionOffset + 16).toString("ascii").replace(/\0+$/, ""),
          segment: buffer.subarray(sectionOffset + 16, sectionOffset + 32).toString("ascii").replace(/\0+$/, ""),
          address: `0x${(cmd === 0x19 ? readUInt64LE(buffer, sectionOffset + 32) : readUInt32(sectionOffset + 32)).toString(16)}`,
          size: cmd === 0x19 ? readUInt64LE(buffer, sectionOffset + 40) : readUInt32(sectionOffset + 36)
        });
        sectionOffset += sectionSize;
      }
    }

    offset += cmdSize;
  }

  return {
    format: "Mach-O",
    architecture: machoCpuName(cpuType),
    class: is64 ? "Mach-O 64-bit" : "Mach-O 32-bit",
    loadCommandCount: commandCount,
    loadCommandsSize: commandsSize,
    sections
  };
}

function inspectBinary(inputPath, options = {}) {
  const { resolvedPath, stats, bytes } = readFileInfo(inputPath, options);
  const formatKey = detectFormat(bytes);
  let details;

  if (formatKey === "pe") {
    details = inspectPe(bytes);
  } else if (formatKey === "elf") {
    details = inspectElf(bytes);
  } else if (formatKey === "macho") {
    details = inspectMachO(bytes);
  } else {
    details = {
      format: "Unknown",
      architecture: "Unknown",
      sections: []
    };
  }

  return {
    inputPath: resolvedPath,
    fileName: path.basename(resolvedPath),
    size: stats.size,
    hashes: {
      md5: sha(bytes, "md5"),
      sha1: sha(bytes, "sha1"),
      sha256: sha(bytes, "sha256")
    },
    entropy: entropy(bytes),
    format: details.format,
    architecture: details.architecture,
    details,
    strings: extractPrintableStrings(bytes)
  };
}

function extractImportsExportsPe(buffer) {
  if (buffer.length < 0x40) return { imports: [], exports: [] };
  const peOffset = buffer.readUInt32LE(0x3c);
  if (peOffset + 24 > buffer.length) return { imports: [], exports: [] };
  if (buffer.subarray(peOffset, peOffset + 4).toString("ascii") !== "PE\u0000\u0000") return { imports: [], exports: [] };

  const optionalHeaderSize = buffer.readUInt16LE(peOffset + 20);
  const optionalStart = peOffset + 24;
  const optionalMagic = buffer.readUInt16LE(optionalStart);
  const isPe32Plus = optionalMagic === 0x20b;
  const dataDirOffset = isPe32Plus ? optionalStart + 112 : optionalStart + 96;
  const importDirRva = buffer.readUInt32LE(dataDirOffset + 8);
  const importDirSize = buffer.readUInt32LE(dataDirOffset + 12);
  const exportDirRva = buffer.readUInt32LE(dataDirOffset);
  const exportDirSize = buffer.readUInt32LE(dataDirOffset + 4);

  function rvaToOffset(rva, sections) {
    for (const s of sections) {
      const vAddr = parseInt(s.virtualAddress, 16);
      const vSize = s.virtualSize;
      if (rva >= vAddr && rva < vAddr + vSize) {
        const rawOffset = parseInt(s.rawOffset, 16);
        return rawOffset + (rva - vAddr);
      }
    }
    return -1;
  }

  const sectionCount = buffer.readUInt16LE(peOffset + 6);
  const sectionStart = optionalStart + optionalHeaderSize;
  const sections = [];
  for (let i = 0; i < sectionCount; i++) {
    const off = sectionStart + i * 40;
    if (off + 40 > buffer.length) break;
    sections.push({
      name: buffer.subarray(off, off + 8).toString("ascii").replace(/\0+$/, ""),
      virtualSize: buffer.readUInt32LE(off + 8),
      virtualAddress: `0x${buffer.readUInt32LE(off + 12).toString(16)}`,
      rawSize: buffer.readUInt32LE(off + 16),
      rawOffset: `0x${buffer.readUInt32LE(off + 20).toString(16)}`
    });
  }

  const imports = [];
  if (importDirRva > 0 && importDirSize > 0) {
    let offset = rvaToOffset(importDirRva, sections);
    if (offset >= 0) {
      const descriptorSize = isPe32Plus ? 20 : 20;
      while (offset + descriptorSize <= buffer.length) {
        const lookupRva = buffer.readUInt32LE(offset);
        const timeStamp = buffer.readUInt32LE(offset + 4);
        const nameRva = buffer.readUInt32LE(offset + 12);
        if (nameRva === 0) break;
        const nameOffset = rvaToOffset(nameRva, sections);
        const dllName = nameOffset >= 0 ? buffer.subarray(nameOffset, buffer.indexOf(0, nameOffset)).toString("ascii") : "";
        const funcs = [];
        if (lookupRva !== 0) {
          let lookupOff = rvaToOffset(lookupRva, sections);
          if (lookupOff >= 0) {
            const wordSize = isPe32Plus ? 8 : 4;
            while (lookupOff + wordSize <= buffer.length) {
              if (isPe32Plus) {
                const entry = buffer.readBigUInt64LE(lookupOff);
                if (entry === 0n) break;
                if ((entry & 0x8000000000000000n) === 0n) {
                  const hintOff = rvaToOffset(Number(entry & 0x7fffffffn), sections);
                  if (hintOff >= 0) {
                    const fname = buffer.subarray(hintOff + 2, Math.min(hintOff + 258, buffer.length));
                    const z = fname.indexOf(0);
                    funcs.push(z >= 0 ? fname.subarray(0, z).toString("ascii") : fname.toString("ascii"));
                  }
                }
              } else {
                const entry = buffer.readUInt32LE(lookupOff);
                if (entry === 0) break;
                if ((entry & 0x80000000) === 0) {
                  const hintOff = rvaToOffset(entry & 0x7fffffff, sections);
                  if (hintOff >= 0) {
                    const fname = buffer.subarray(hintOff + 2, Math.min(hintOff + 258, buffer.length));
                    const z = fname.indexOf(0);
                    funcs.push(z >= 0 ? fname.subarray(0, z).toString("ascii") : fname.toString("ascii"));
                  }
                }
              }
              lookupOff += wordSize;
            }
          }
        }
        imports.push({ dll: dllName, functions: funcs, timeStamp });
        offset += descriptorSize;
      }
    }
  }

  const exports = [];
  if (exportDirRva > 0 && exportDirSize > 0) {
    const expOff = rvaToOffset(exportDirRva, sections);
    if (expOff >= 0 && expOff + 40 <= buffer.length) {
      const nameCount = buffer.readUInt32LE(expOff + 24);
      const funcCount = buffer.readUInt32LE(expOff + 20);
      const namesRva = buffer.readUInt32LE(expOff + 32);
      const ordinalsRva = buffer.readUInt32LE(expOff + 36);
      const funcsRva = buffer.readUInt32LE(expOff + 28);
      if (namesRva > 0 && ordinalsRva > 0) {
        const namesOff = rvaToOffset(namesRva, sections);
        const ordsOff = rvaToOffset(ordinalsRva, sections);
        if (namesOff >= 0 && ordsOff >= 0) {
          for (let i = 0; i < nameCount; i++) {
            if (namesOff + (i + 1) * 4 > buffer.length) break;
            const namePtr = buffer.readUInt32LE(namesOff + i * 4);
            const nameOff = rvaToOffset(namePtr, sections);
            const ordinal = buffer.readUInt16LE(ordsOff + i * 2);
            const name = nameOff >= 0 ? buffer.subarray(nameOff, buffer.indexOf(0, nameOff)).toString("ascii") : "";
            exports.push({ name, ordinal });
          }
        }
      }
      if (funcsRva > 0 && funcCount > nameCount) {
        const funcsOff = rvaToOffset(funcsRva, sections);
        if (funcsOff >= 0) {
          for (let i = 0; i < funcCount; i++) {
            if (funcsOff + (i + 1) * 4 > buffer.length) break;
            const rva = buffer.readUInt32LE(funcsOff + i * 4);
            if (rva !== 0) exports.push({ ordinal: i + 1, rva: `0x${rva.toString(16)}` });
          }
        }
      }
    }
  }

  return { imports, exports };
}

function extractResourcesPe(buffer) {
  const resources = [];
  if (buffer.length < 0x40) return resources;
  const peOffset = buffer.readUInt32LE(0x3c);
  if (peOffset + 24 > buffer.length) return resources;
  if (buffer.subarray(peOffset, peOffset + 4).toString("ascii") !== "PE\u0000\u0000") return resources;

  const optionalHeaderSize = buffer.readUInt16LE(peOffset + 20);
  const optionalStart = peOffset + 24;
  const optionalMagic = buffer.readUInt16LE(optionalStart);
  const isPe32Plus = optionalMagic === 0x20b;
  const dataDirOffset = isPe32Plus ? optionalStart + 112 : optionalStart + 96;
  const resourceRva = buffer.readUInt32LE(dataDirOffset + 16 * 2);
  const resourceSize = buffer.readUInt32LE(dataDirOffset + 16 * 2 + 4);
  if (resourceRva === 0 || resourceSize === 0) return resources;

  const sectionCount = buffer.readUInt16LE(peOffset + 6);
  const sectionStart = optionalStart + optionalHeaderSize;
  const sections = [];
  for (let i = 0; i < sectionCount; i++) {
    const off = sectionStart + i * 40;
    if (off + 40 > buffer.length) break;
    sections.push({
      name: buffer.subarray(off, off + 8).toString("ascii").replace(/\0+$/, ""),
      virtualSize: buffer.readUInt32LE(off + 8),
      virtualAddress: buffer.readUInt32LE(off + 12),
      rawSize: buffer.readUInt32LE(off + 16),
      rawOffset: buffer.readUInt32LE(off + 20)
    });
  }

  function rvaToOffset(rva) {
    for (const s of sections) {
      if (rva >= s.virtualAddress && rva < s.virtualAddress + s.virtualSize) {
        return s.rawOffset + (rva - s.virtualAddress);
      }
    }
    return -1;
  }

  function readStringAt(off) {
    let end = off;
    while (end < buffer.length && buffer[end] !== 0) end++;
    return buffer.subarray(off, end).toString("utf16le");
  }

  function parseNode(off, depth = 0) {
    if (off + 16 > buffer.length) return;
    const characteristics = buffer.readUInt32LE(off);
    const timeStamp = buffer.readUInt32LE(off + 4);
    const major = buffer.readUInt16LE(off + 8);
    const minor = buffer.readUInt16LE(off + 10);
    const namedEntries = buffer.readUInt16LE(off + 12);
    const idEntries = buffer.readUInt16LE(off + 14);
    const total = namedEntries + idEntries;

    for (let i = 0; i < total; i++) {
      const entryOff = off + 16 + i * 8;
      if (entryOff + 8 > buffer.length) break;
      const nameOrId = buffer.readUInt32LE(entryOff);
      const dataOff = buffer.readUInt32LE(entryOff + 4);
      const isData = (dataOff & 0x80000000) === 0;
      const childOff = rvaToOffset(resourceRva + (dataOff & 0x7fffffff));
      let entryName = null;
      if ((nameOrId & 0x80000000) !== 0) {
        const nameOffAbs = rvaToOffset(resourceRva + (nameOrId & 0x7fffffff));
        if (nameOffAbs >= 0 && nameOffAbs + 2 <= buffer.length) {
          const len = buffer.readUInt16LE(nameOffAbs);
          entryName = buffer.subarray(nameOffAbs + 2, nameOffAbs + 2 + len * 2).toString("utf16le");
        }
      } else {
        entryName = String(nameOrId);
      }

      if (isData && childOff >= 0 && childOff + 16 <= buffer.length) {
        const dataRva = buffer.readUInt32LE(childOff);
        const dataSize = buffer.readUInt32LE(childOff + 4);
        const codePage = buffer.readUInt32LE(childOff + 8);
        const dataAbsOff = rvaToOffset(dataRva);
        const typeNames = { 1: "CURSOR", 2: "BITMAP", 3: "ICON", 4: "MENU", 5: "DIALOG", 6: "STRING", 7: "FONTDIR", 8: "FONT", 9: "ACCELERATOR", 10: "RCDATA", 11: "MESSAGETABLE", 12: "GROUP_CURSOR", 14: "GROUP_ICON", 16: "VERSION", 24: "MANIFEST" };
        resources.push({
          type: typeNames[Number(entryName)] || `ID:${entryName}`,
          size: dataSize,
          codePage,
          offset: dataAbsOff >= 0 ? `0x${dataAbsOff.toString(16)}` : null
        });
      } else if (!isData && childOff >= 0) {
        parseNode(childOff, depth + 1);
      }
    }
  }

  const rootOff = rvaToOffset(resourceRva);
  if (rootOff >= 0) parseNode(rootOff);
  return resources;
}

function categorizeStrings(strings) {
  const categories = { urls: [], paths: [], registry: [], errors: [], api: [], other: [] };
  const urlPattern = /^(https?|ftp|file):\/\/[^\s]+$/i;
  const pathPattern = /^[a-zA-Z]:\\|^\/[^\s]*|^%.+%|^\\[^\s]+/;
  const regPattern = /^HKEY_|^HKCU\\|^HKLM\\|^Software\\|^System\\CurrentControlSet/i;
  const errPattern = /error|fail|exception|abort|crash|invalid|not found|access denied/i;
  const apiPattern = /^(Create|Get|Set|Open|Close|Read|Write|Delete|Find|Load|Free|Reg|Nt|Zw)[A-Z]/;

  for (const s of strings) {
    if (urlPattern.test(s)) categories.urls.push(s);
    else if (pathPattern.test(s)) categories.paths.push(s);
    else if (regPattern.test(s)) categories.registry.push(s);
    else if (errPattern.test(s)) categories.errors.push(s);
    else if (apiPattern.test(s)) categories.api.push(s);
    else categories.other.push(s);
  }
  return categories;
}

function generateStructuralReport(details) {
  return {
    format: details.format,
    architecture: details.architecture,
    entryPoint: details.entryPoint || null,
    imageBase: details.imageBase || null,
    subsystem: details.subsystem || null,
    class: details.class || null,
    endianness: details.endianness || null,
    timestampUtc: details.timestampUtc || null,
    sectionCount: details.sectionCount || (details.sections ? details.sections.length : 0),
    sections: (details.sections || []).map((s) => ({
      name: s.name,
      address: s.virtualAddress || s.address || null,
      size: s.rawSize || s.size || s.virtualSize || null,
      offset: s.rawOffset || s.offset || null
    }))
  };
}

function decompileBinary(inputPath, outputDir = null, options = {}) {
  const fs = require("node:fs");
  const path = require("node:path");
  const resolved = path.resolve(String(inputPath).trim());
  const stats = fs.statSync(resolved);

  if (stats.isDirectory()) {
    if (!options.batch) {
      throw new Error("Input is a directory. Use batch mode or select a file.");
    }
    const results = [];
    const entries = fs.readdirSync(resolved);
    for (const entry of entries) {
      const full = path.join(resolved, entry);
      try {
        const s = fs.statSync(full);
        if (s.isFile()) {
          const ext = path.extname(full).toLowerCase();
          if ([".exe", ".dll", ".sys", ".bin", ".elf", ".o", ".so", ".dylib", ".app"].includes(ext) || ext === "") {
            const r = decompileBinary(full, outputDir, { batch: true, skipDirCheck: true });
            results.push(r);
          }
        }
      } catch (_e) { /* ignore unreadable */ }
    }
    return results;
  }

  const { bytes } = readFileInfo(resolved, options);
  const formatKey = detectFormat(bytes);
  let details;

  if (formatKey === "pe") {
    details = inspectPe(bytes);
    details.importsExports = extractImportsExportsPe(bytes);
    details.resources = extractResourcesPe(bytes);
  } else if (formatKey === "elf") {
    details = inspectElf(bytes);
    details.importsExports = { imports: [], exports: [] };
    details.resources = [];
  } else if (formatKey === "macho") {
    details = inspectMachO(bytes);
    details.importsExports = { imports: [], exports: [] };
    details.resources = [];
  } else {
    details = {
      format: "Unknown",
      architecture: "Unknown",
      sections: [],
      importsExports: { imports: [], exports: [] },
      resources: []
    };
  }

  const strings = extractPrintableStrings(bytes, 500);
  const deepStrings = categorizeStrings(strings);
  const structuralReport = generateStructuralReport(details);

  const result = {
    inputPath: resolved,
    fileName: path.basename(resolved),
    size: stats.size,
    format: details.format,
    architecture: details.architecture,
    importsExports: details.importsExports,
    resources: details.resources,
    deepStrings: strings,
    categorizedStrings: deepStrings,
    structuralReport
  };

  if (outputDir) {
    saveDecompileResults(result, outputDir);
  }

  return result;
}

function saveDecompileResults(results, outputDir) {
  const fs = require("node:fs");
  const path = require("node:path");
  const out = path.resolve(String(outputDir).trim());
  if (!fs.existsSync(out)) fs.mkdirSync(out, { recursive: true });

  const items = Array.isArray(results) ? results : [results];
  const saved = [];

  for (const result of items) {
    const base = `${path.basename(result.fileName)}_decompile`;
    const importsPath = path.join(out, `${base}_imports_exports.json`);
    const resourcesPath = path.join(out, `${base}_resources.json`);
    const stringsPath = path.join(out, `${base}_strings.txt`);
    const structPath = path.join(out, `${base}_structural_report.json`);

    fs.writeFileSync(importsPath, JSON.stringify(result.importsExports, null, 2), "utf8");
    fs.writeFileSync(resourcesPath, JSON.stringify(result.resources, null, 2), "utf8");
    fs.writeFileSync(stringsPath, result.deepStrings.join("\n"), "utf8");
    fs.writeFileSync(structPath, JSON.stringify(result.structuralReport, null, 2), "utf8");

    saved.push({ importsPath, resourcesPath, stringsPath, structPath });
  }

  return { savedTo: out, files: saved };
}

module.exports = {
  detectFormat,
  inspectBinary,
  extractPrintableStrings,
  decompileBinary,
  saveDecompileResults
};
