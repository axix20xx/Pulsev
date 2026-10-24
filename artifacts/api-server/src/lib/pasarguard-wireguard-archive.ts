import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_FILE_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const MAX_ARCHIVE_BYTES = 8 * 1024 * 1024;
const MAX_CONFIG_BYTES = 512 * 1024;
const MAX_TOTAL_CONFIG_BYTES = 4 * 1024 * 1024;
const MAX_CONFIG_FILES = 40;

export type PasarGuardWireGuardConfig = {
  id: string;
  name: string;
  fileName: string;
  body: string;
};

function crc32(input: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function findEndOfCentralDirectory(archive: Buffer): number {
  const earliest = Math.max(0, archive.length - 22 - 0xffff);
  for (let offset = archive.length - 22; offset >= earliest; offset -= 1) {
    if (
      archive.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY
      && offset + 22 + archive.readUInt16LE(offset + 20) === archive.length
    ) {
      return offset;
    }
  }
  throw new Error("PasarGuard returned an invalid WireGuard ZIP archive.");
}

function safeConfigName(value: string): string | null {
  if (
    !value
    || value.length > 255
    || /[\u0000-\u001f\u007f/\\]/.test(value)
    || value === "."
    || value === ".."
    || !/\.conf$/i.test(value)
  ) {
    return null;
  }
  return value;
}

function wireGuardLocationId(fileName: string): string {
  return `pg-${createHash("sha256").update(fileName).digest("hex").slice(0, 20)}`;
}

function displayName(fileName: string): string {
  const name = fileName.replace(/\.conf$/i, "").replace(/[_-]+/g, " ").trim();
  return (name || "WireGuard server").slice(0, 120);
}

function validateConfig(body: string): void {
  if (
    !/^\s*\[Interface\]\s*$/im.test(body)
    || !/^\s*\[Peer\]\s*$/im.test(body)
    || !/^\s*PrivateKey\s*=\s*\S+/im.test(body)
    || !/^\s*PublicKey\s*=\s*\S+/im.test(body)
  ) {
    throw new Error("PasarGuard returned a WireGuard file without a usable Interface and Peer config.");
  }
}

export function parsePasarGuardWireGuardArchive(input: Uint8Array): PasarGuardWireGuardConfig[] {
  const archive = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (archive.length < 22) {
    throw new Error("PasarGuard returned an invalid WireGuard ZIP archive.");
  }
  if (archive.length > MAX_ARCHIVE_BYTES) {
    throw new Error("PasarGuard WireGuard archive exceeds the supported size.");
  }

  const endOffset = findEndOfCentralDirectory(archive);
  const diskNumber = archive.readUInt16LE(endOffset + 4);
  const centralDiskNumber = archive.readUInt16LE(endOffset + 6);
  const diskEntryCount = archive.readUInt16LE(endOffset + 8);
  const entryCount = archive.readUInt16LE(endOffset + 10);
  const centralSize = archive.readUInt32LE(endOffset + 12);
  const centralOffset = archive.readUInt32LE(endOffset + 16);
  if (
    diskNumber !== 0
    || centralDiskNumber !== 0
    || diskEntryCount !== entryCount
    || entryCount === 0
    || entryCount > MAX_CONFIG_FILES
    || centralOffset + centralSize > endOffset
  ) {
    throw new Error("PasarGuard returned an unsupported or invalid WireGuard ZIP archive.");
  }

  const configs: PasarGuardWireGuardConfig[] = [];
  const seenNames = new Set<string>();
  let totalConfigBytes = 0;
  let cursor = centralOffset;
  const centralEnd = centralOffset + centralSize;

  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > centralEnd || archive.readUInt32LE(cursor) !== CENTRAL_DIRECTORY_FILE_HEADER) {
      throw new Error("PasarGuard returned an invalid WireGuard ZIP directory.");
    }

    const flags = archive.readUInt16LE(cursor + 8);
    const method = archive.readUInt16LE(cursor + 10);
    const expectedCrc = archive.readUInt32LE(cursor + 16);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const uncompressedSize = archive.readUInt32LE(cursor + 24);
    const fileNameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const diskStart = archive.readUInt16LE(cursor + 34);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const recordEnd = cursor + 46 + fileNameLength + extraLength + commentLength;
    if (
      recordEnd > centralEnd
      || diskStart !== 0
      || compressedSize === 0xffffffff
      || uncompressedSize === 0xffffffff
      || localOffset === 0xffffffff
      || (flags & 0x0001) !== 0
      || ![0, 8].includes(method)
    ) {
      throw new Error("PasarGuard returned an unsupported WireGuard ZIP entry.");
    }

    let fileName: string;
    try {
      fileName = new TextDecoder("utf-8", { fatal: true }).decode(
        archive.subarray(cursor + 46, cursor + 46 + fileNameLength),
      );
    } catch {
      throw new Error("PasarGuard returned a WireGuard filename that is not valid UTF-8.");
    }
    cursor = recordEnd;
    const safeName = safeConfigName(fileName);
    if (!safeName) continue;
    if (seenNames.has(safeName)) {
      throw new Error("PasarGuard returned duplicate WireGuard filenames.");
    }
    seenNames.add(safeName);
    if (
      uncompressedSize === 0
      || uncompressedSize > MAX_CONFIG_BYTES
      || totalConfigBytes + uncompressedSize > MAX_TOTAL_CONFIG_BYTES
    ) {
      throw new Error("PasarGuard returned a WireGuard config that exceeds the supported size.");
    }
    totalConfigBytes += uncompressedSize;

    if (
      localOffset + 30 > centralOffset
      || archive.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER
    ) {
      throw new Error("PasarGuard returned an invalid WireGuard ZIP entry header.");
    }
    const localFlags = archive.readUInt16LE(localOffset + 6);
    const localMethod = archive.readUInt16LE(localOffset + 8);
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (
      (localFlags & 0x0001) !== 0
      || localMethod !== method
      || dataStart > centralOffset
      || dataEnd > centralOffset
      || localNameLength !== fileNameLength
      || !archive.subarray(localOffset + 30, localOffset + 30 + localNameLength)
        .equals(Buffer.from(fileName, "utf8"))
    ) {
      throw new Error("PasarGuard returned an inconsistent WireGuard ZIP entry.");
    }

    const compressed = archive.subarray(dataStart, dataEnd);
    let content: Buffer;
    try {
      content = method === 0
        ? Buffer.from(compressed)
        : inflateRawSync(compressed, { maxOutputLength: MAX_CONFIG_BYTES });
    } catch {
      throw new Error("PasarGuard returned a damaged or oversized WireGuard config.");
    }
    if (content.length !== uncompressedSize || crc32(content) !== expectedCrc) {
      throw new Error("PasarGuard returned a damaged WireGuard config.");
    }

    let body: string;
    try {
      body = new TextDecoder("utf-8", { fatal: true }).decode(content).trim();
    } catch {
      throw new Error("PasarGuard returned a WireGuard config that is not valid UTF-8.");
    }
    validateConfig(body);
    configs.push({
      id: wireGuardLocationId(safeName),
      name: displayName(safeName),
      fileName: safeName,
      body,
    });
  }

  if (cursor !== centralEnd || configs.length === 0) {
    throw new Error("PasarGuard returned no usable WireGuard .conf files.");
  }
  return configs;
}
