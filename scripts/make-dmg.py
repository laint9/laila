#!/usr/bin/env python3
"""Tạo file .dmg (UDIF nén zlib, giống `hdiutil create -format UDZO`) trên Linux.

  python3 scripts/make-dmg.py <thư mục nội dung> <file.dmg> "<Tên ổ đĩa>"

Các bước:
  1. xorriso dựng ổ HFS+ (giữ symlink, quyền thực thi — app macOS cần cả hai).
  2. Cắt lấy đúng phân vùng HFS+ từ ảnh hybrid.
  3. Bọc thành UDIF: chia khối 256 KB, nén zlib, bảng khối "mish", plist, header "koly", CRC32.
"""
import os
import plistlib
import struct
import subprocess
import sys
import tempfile
import uuid
import zlib

SECTOR = 512
CHUNK_SECTORS = 0x200  # 256 KB mỗi khối, như hdiutil/libdmg
BUFFERS_NEEDED = 0x208

ENTRY_ZLIB = 0x80000005
ENTRY_RAW = 0x00000001
ENTRY_ZERO = 0x00000002
ENTRY_END = 0xFFFFFFFF


def build_hfs(src_dir: str, volname: str) -> bytes:
    with tempfile.TemporaryDirectory() as tmp:
        iso = os.path.join(tmp, 'v.iso')
        subprocess.run(
            ['xorriso', '-as', 'mkisofs', '-quiet', '-V', volname, '-hfsplus', '-apm-block-size', '2048',
             '-R', '-o', iso, src_dir],
            check=True,
        )
        data = open(iso, 'rb').read()
    # Driver Descriptor Map + Apple Partition Map: tìm phân vùng Apple_HFS
    if data[:2] != b'ER':
        raise SystemExit('xorriso không tạo bảng phân vùng Apple')
    bs = struct.unpack('>H', data[2:4])[0]
    for i in range(1, 64):
        e = data[i * bs:i * bs + 512]
        if e[:2] != b'PM':
            break
        ptype = e[48:80].rstrip(b'\0')
        start = struct.unpack('>I', e[8:12])[0]
        if ptype == b'Apple_HFS':
            hfs = data[start * bs:]
            sig = hfs[1024:1026]
            if sig not in (b'H+', b'HX'):
                raise SystemExit(f'Không thấy chữ ký HFS+ (được {sig!r})')
            pad = (-len(hfs)) % SECTOR
            return hfs + b'\0' * pad
    raise SystemExit('Không thấy phân vùng Apple_HFS')


def checksum_field(crc: int) -> bytes:
    return struct.pack('>I', crc & 0xFFFFFFFF) + b'\0' * 124


def write_udif(volume: bytes, out_path: str, name: str = 'disk image (Apple_HFS : 0)') -> None:
    sectors = len(volume) // SECTOR
    chunks = []  # (type, sector, count, offset, length)
    fork = bytearray()
    for s in range(0, sectors, CHUNK_SECTORS):
        n = min(CHUNK_SECTORS, sectors - s)
        block = volume[s * SECTOR:(s + n) * SECTOR]
        if not block.strip(b'\0'):
            chunks.append((ENTRY_ZERO, s, n, len(fork), 0))
            continue
        comp = zlib.compress(block, 9)
        if len(comp) >= len(block):
            chunks.append((ENTRY_RAW, s, n, len(fork), len(block)))
            fork += block
        else:
            chunks.append((ENTRY_ZLIB, s, n, len(fork), len(comp)))
            fork += comp
    chunks.append((ENTRY_END, sectors, 0, len(fork), 0))

    part_crc = zlib.crc32(volume)
    mish = bytearray()
    mish += b'mish'
    mish += struct.pack('>I', 1)                 # version
    mish += struct.pack('>Q', 0)                 # first sector
    mish += struct.pack('>Q', sectors)           # sector count
    mish += struct.pack('>Q', 0)                 # data offset
    mish += struct.pack('>I', BUFFERS_NEEDED)
    mish += struct.pack('>I', 0)                 # block descriptors
    mish += b'\0' * 24                           # reserved
    mish += struct.pack('>II', 2, 32)            # CRC32
    mish += checksum_field(part_crc)
    mish += struct.pack('>I', len(chunks))
    for t, s, n, off, ln in chunks:
        mish += struct.pack('>IIQQQQ', t, 0, s, n, off, ln)

    plist = plistlib.dumps({
        'resource-fork': {
            'blkx': [{
                'Attributes': '0x0050',
                'CFName': name,
                'Data': bytes(mish),
                'ID': '-1',
                'Name': name,
            }],
        }
    }, fmt=plistlib.FMT_XML)

    data_crc = zlib.crc32(bytes(fork))
    master_crc = zlib.crc32(struct.pack('>I', part_crc & 0xFFFFFFFF))
    xml_offset = len(fork)

    koly = bytearray()
    koly += b'koly'
    koly += struct.pack('>III', 4, 512, 1)                  # version, header size, flags (flattened)
    koly += struct.pack('>QQQQQ', 0, 0, len(fork), 0, 0)   # running/data fork offset+len, rsrc fork
    koly += struct.pack('>II', 1, 1)                        # segment number / count
    koly += uuid.uuid4().bytes
    koly += struct.pack('>II', 2, 32) + checksum_field(data_crc)
    koly += struct.pack('>QQ', xml_offset, len(plist))
    koly += b'\0' * 120
    koly += struct.pack('>II', 2, 32) + checksum_field(master_crc)
    koly += struct.pack('>IQ', 1, sectors)                  # image variant, sector count
    koly += b'\0' * 12
    assert len(koly) == 512, len(koly)

    with open(out_path, 'wb') as f:
        f.write(fork)
        f.write(plist)
        f.write(koly)


def main():
    if len(sys.argv) < 4:
        raise SystemExit(__doc__)
    src, out, vol = sys.argv[1], sys.argv[2], sys.argv[3]
    volume = build_hfs(src, vol)
    write_udif(volume, out)
    print(f'{out}: {os.path.getsize(out) / 1e6:.1f} MB (ổ đĩa {len(volume) / 1e6:.1f} MB)')


if __name__ == '__main__':
    main()
