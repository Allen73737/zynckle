import { inflateRawSync } from 'node:zlib';

/**
 * Minimal, defensive ZIP reader. Entries are returned in memory and are never written
 * to disk using archive-supplied paths, so path traversal cannot escape the store.
 * Names are still validated so the resulting tree is clean and predictable.
 */
export function readZip(buffer, { maxEntries = 3000, maxEntryBytes = 2_000_000, maxTotalBytes = 80_000_000, maxRatio = 200 } = {}) {
  const eocdSearchStart = Math.max(0, buffer.length - 65_557);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= eocdSearchStart; i--) if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This file is not a valid ZIP archive');
  const count = buffer.readUInt16LE(eocd + 10);
  const cdSize = buffer.readUInt32LE(eocd + 12);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new Error('ZIP64 archives are not supported');
  if (count > maxEntries) throw new Error(`Archives are limited to ${maxEntries} entries`);
  if (cdOffset + cdSize > buffer.length) throw new Error('The ZIP archive is truncated');

  const entries = [];
  const skipped = [];
  let total = 0;
  let pointer = cdOffset;
  for (let n = 0; n < count; n++) {
    if (buffer.readUInt32LE(pointer) !== 0x02014b50) throw new Error('The ZIP central directory is corrupted');
    const flags = buffer.readUInt16LE(pointer + 8);
    const method = buffer.readUInt16LE(pointer + 10);
    const compressedSize = buffer.readUInt32LE(pointer + 20);
    const size = buffer.readUInt32LE(pointer + 24);
    const nameLength = buffer.readUInt16LE(pointer + 28);
    const extraLength = buffer.readUInt16LE(pointer + 30);
    const commentLength = buffer.readUInt16LE(pointer + 32);
    const externalAttrs = buffer.readUInt32LE(pointer + 38);
    const localOffset = buffer.readUInt32LE(pointer + 42);
    const rawName = buffer.subarray(pointer + 46, pointer + 46 + nameLength).toString(flags & 0x800 ? 'utf8' : 'latin1');
    pointer += 46 + nameLength + extraLength + commentLength;

    if (rawName.endsWith('/')) continue; // directory entry
    const name = normalizeEntryPath(rawName);
    if (!name) { skipped.push({ name: rawName, reason: 'unsafe path' }); continue; }
    if (((externalAttrs >>> 16) & 0o170000) === 0o120000) { skipped.push({ name, reason: 'symbolic link' }); continue; }
    if (flags & 0x1) { skipped.push({ name, reason: 'encrypted' }); continue; }
    if (size > maxEntryBytes) { skipped.push({ name, reason: 'too large' }); continue; }
    if (compressedSize && size / compressedSize > maxRatio) throw new Error('The archive looks like a decompression bomb and was rejected');
    total += size;
    if (total > maxTotalBytes) throw new Error('The archive expands beyond the allowed size');

    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('A ZIP entry header is corrupted');
    const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    let data;
    if (method === 0) data = Buffer.from(compressed);
    else if (method === 8) data = inflateRawSync(compressed, { maxOutputLength: maxEntryBytes + 1 });
    else { skipped.push({ name, reason: 'unsupported compression' }); continue; }
    if (data.length !== size) throw new Error(`Entry ${name} did not match its declared size`);
    entries.push({ name, data });
  }
  return { entries, skipped };
}

/** Return a clean relative path, or null if the path is unsafe or unwanted. */
export function normalizeEntryPath(raw) {
  if (typeof raw !== 'string' || raw.includes('\0')) return null;
  const path = raw.replace(/\\/g, '/');
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) return null;
  const parts = path.split('/').filter(part => part && part !== '.');
  if (!parts.length || parts.some(part => part === '..' || part.length > 120 || /[\u0000-\u001f<>:"|?*]/.test(part))) return null;
  if (parts.some(part => ['__MACOSX', '.git', 'node_modules', '.DS_Store'].includes(part))) return null;
  const clean = parts.join('/');
  return clean.length <= 400 ? clean : null;
}

const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = bytes => { let c = 0xffffffff; for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

/** Write an uncompressed ZIP (used for "download project"). */
export function writeZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt16LE(0, 8);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(nameBytes.length, 26);
    locals.push(header, nameBytes, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
