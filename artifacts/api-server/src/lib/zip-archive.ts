import { deflateRawSync } from "node:zlib";

export type ZipFileEntry = {
  name: string;
  content: string | Uint8Array;
};

const crc32 = (input: Buffer): number => {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const safeEntryName = (value: string): string => {
  const name = value
    .replace(/\\/g, "/")
    .split("/")
    .pop()!
    .replace(/[\u0000-\u001f\u007f]/g, "_")
    .trim()
    .slice(0, 180);
  if (!name || name === "." || name === "..") {
    throw new Error("ZIP entry needs a safe filename.");
  }
  return name;
};

/**
 * Creates a small UTF-8 ZIP archive without relying on a platform `zip` binary.
 * This is used for downloadable multi-server configs, with one importable file
 * per server rather than a concatenated text document.
 */
export function createZipArchive(entries: ZipFileEntry[]): Buffer {
  if (entries.length === 0 || entries.length > 0xffff) {
    throw new Error("ZIP archive must contain between 1 and 65,535 files.");
  }

  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  const seenNames = new Set<string>();
  let localOffset = 0;

  for (const entry of entries) {
    const name = safeEntryName(entry.name);
    if (seenNames.has(name)) throw new Error("ZIP archive contains duplicate filenames.");
    seenNames.add(name);

    const filename = Buffer.from(name, "utf8");
    const content = Buffer.isBuffer(entry.content)
      ? entry.content
      : Buffer.from(entry.content);
    const compressed = deflateRawSync(content);
    const checksum = crc32(content);
    if (filename.length > 0xffff || compressed.length > 0xffffffff || content.length > 0xffffffff) {
      throw new Error("ZIP entry exceeds the supported ZIP32 size.");
    }

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 filename
    localHeader.writeUInt16LE(8, 8); // DEFLATE
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0x0021, 12); // 1980-01-01
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(filename.length, 26);
    localHeader.writeUInt16LE(0, 28);
    const localRecord = Buffer.concat([localHeader, filename, compressed]);
    localParts.push(localRecord);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0x0021, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(filename.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(Buffer.concat([centralHeader, filename]));
    localOffset += localRecord.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}
