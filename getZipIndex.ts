async function readCentralDirectory(url) {
  const sizeResponse = await fetch(url, {
    headers: {
      Range: "bytes=0-0",
    },
  });

  const contentX = sizeResponse.headers.get("content-length");
  const contentRange = sizeResponse.headers.get("content-range");
  console.log(contentRange, contentX);
  if (!contentRange) {
    throw new Error("Server does not support range requests");
  }

  const fileSize = parseInt(contentRange.split("/")[1]);
  const MAX_EOCD_SIZE = 65557;
  const readSize = Math.min(MAX_EOCD_SIZE, fileSize);
  const rangeStart = fileSize - readSize;

  const response = await fetch(url, {
    headers: {
      Range: `bytes=${rangeStart}-${fileSize - 1}`,
    },
  });

  const buffer = await response.arrayBuffer();
  const view = new Uint8Array(buffer);

  let eocdStart = -1;
  for (let i = view.length - 22; i >= 0; i--) {
    if (
      view[i] === 0x50 &&
      view[i + 1] === 0x4b &&
      view[i + 2] === 0x05 &&
      view[i + 3] === 0x06
    ) {
      eocdStart = i;
      break;
    }
  }

  if (eocdStart === -1) {
    throw new Error("End of Central Directory not found");
  }

  const eocdView = new DataView(buffer, eocdStart);
  const centralDirSize = eocdView.getUint32(12, true);
  const centralDirOffset = eocdView.getUint32(16, true);
  console.log({ centralDirSize, centralDirOffset });

  const cdResponse = await fetch(url, {
    headers: {
      Range: `bytes=${centralDirOffset}-${
        centralDirOffset + centralDirSize - 1
      }`,
    },
  });

  const centralDirBuffer = await cdResponse.arrayBuffer();
  return parseCentralDirectory(centralDirBuffer);
}

function parseExtraField(buffer, offset, length) {
  const extraFields = [];
  let currentOffset = offset;
  const endOffset = offset + length;

  while (currentOffset < endOffset) {
    const view = new DataView(buffer, currentOffset);
    const headerID = view.getUint16(0, true);
    const dataSize = view.getUint16(2, true);
    const data = new Uint8Array(buffer, currentOffset + 4, dataSize);

    const extraField: { [key: string]: any } = {
      headerID,
      dataSize,
      data: Array.from(data), // Convert to regular array for easier viewing
    };

    // Parse known extra field types
    switch (headerID) {
      case 0x0001: // ZIP64 extended information
        extraField.type = "ZIP64";
        if (dataSize >= 8)
          extraField.uncompressedSize = view.getBigUint64(4, true);
        if (dataSize >= 16)
          extraField.compressedSize = view.getBigUint64(12, true);
        if (dataSize >= 24)
          extraField.localHeaderOffset = view.getBigUint64(20, true);
        break;
      case 0x000d: // PKWARE Unix
        extraField.type = "UNIX";
        if (dataSize >= 12) {
          extraField.atime = new Date(view.getUint32(4, true) * 1000);
          extraField.mtime = new Date(view.getUint32(8, true) * 1000);
          extraField.uid = view.getUint16(12, true);
          extraField.gid = view.getUint16(14, true);
        }
        break;
      case 0x5455: // Extended timestamp
        extraField.type = "ExtendedTimestamp";
        const flags = data[0];
        let pos = 1;
        if (flags & 1) {
          // Modification time
          extraField.mtime = new Date(view.getUint32(4, true) * 1000);
          pos += 4;
        }
        if (flags & 2) {
          // Access time
          extraField.atime = new Date(view.getUint32(pos, true) * 1000);
          pos += 4;
        }
        if (flags & 4) {
          // Creation time
          extraField.ctime = new Date(view.getUint32(pos, true) * 1000);
        }
        break;
      case 0x7075: // Unicode Path
        extraField.type = "UnicodePath";
        extraField.version = data[0];
        extraField.nameCRC32 = view.getUint32(1, true);
        extraField.unicodeName = new TextDecoder().decode(data.slice(5));
        break;
    }

    extraFields.push(extraField);
    currentOffset += 4 + dataSize;
  }

  return extraFields;
}

function parseDosDate(date, time) {
  const year = ((date & 0xfe00) >> 9) + 1980;
  const month = (date & 0x01e0) >> 5;
  const day = date & 0x001f;

  const hours = (time & 0xf800) >> 11;
  const minutes = (time & 0x07e0) >> 5;
  const seconds = (time & 0x001f) * 2;

  return new Date(year, month - 1, day, hours, minutes, seconds);
}

function parseCentralDirectory(buffer) {
  const view = new DataView(buffer);
  const entries = [];
  let offset = 0;

  while (offset < buffer.byteLength) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      break;
    }

    const entry: any = {
      fileName: undefined as string | undefined,
      versionMadeBy: view.getUint16(offset + 4, true),
      versionNeededPlatform: (view.getUint16(offset + 4, true) >> 8) & 0xff,
      versionNeeded: view.getUint16(offset + 6, true),
      generalPurposeBitFlag: view.getUint16(offset + 8, true),
      compressionMethod: view.getUint16(offset + 10, true),
      lastModifiedTime: view.getUint16(offset + 12, true),
      lastModifiedDate: view.getUint16(offset + 14, true),
      lastModified: parseDosDate(
        view.getUint16(offset + 14, true),
        view.getUint16(offset + 12, true),
      ),
      crc32: view
        .getUint32(offset + 16, true)
        .toString(16)
        .padStart(8, "0"),
      compressedSize: view.getUint32(offset + 20, true),
      uncompressedSize: view.getUint32(offset + 24, true),
      fileNameLength: view.getUint16(offset + 28, true),
      extraFieldLength: view.getUint16(offset + 30, true),
      fileCommentLength: view.getUint16(offset + 32, true),
      diskNumberStart: view.getUint16(offset + 34, true),
      internalFileAttributes: view.getUint16(offset + 36, true),
      externalFileAttributes: view.getUint32(offset + 38, true),
      localHeaderOffset: view.getUint32(offset + 42, true),
      isEncrypted: (view.getUint16(offset + 8, true) & 0x1) !== 0,
      isDirectory: (view.getUint32(offset + 38, true) & 0x10) !== 0,
      hasDataDescriptor: (view.getUint16(offset + 8, true) & 0x8) !== 0,
      hasUtf8FileName: (view.getUint16(offset + 8, true) & 0x800) !== 0,
    };

    // Read filename
    const fileNameStart = offset + 46;
    const fileNameEnd = fileNameStart + entry.fileNameLength;
    entry.fileName = new TextDecoder().decode(
      new Uint8Array(buffer, fileNameStart, entry.fileNameLength),
    );

    // Parse extra fields if present
    if (entry.extraFieldLength > 0) {
      entry.extraFields = parseExtraField(
        buffer,
        fileNameEnd,
        entry.extraFieldLength,
      );
    }

    // Read file comment if present
    if (entry.fileCommentLength > 0) {
      const commentStart = fileNameEnd + entry.extraFieldLength;
      entry.fileComment = new TextDecoder().decode(
        new Uint8Array(buffer, commentStart, entry.fileCommentLength),
      );
    }

    entries.push(entry);
    offset = fileNameEnd + entry.extraFieldLength + entry.fileCommentLength;
  }

  return entries;
}

// Example usage:
async function example() {
  try {
    const zipUrl = "https://test.zipobject.com/main.zip";
    const entries = await readCentralDirectory(zipUrl);
    console.log("ZIP contents found:", entries.length);
    console.dir(
      entries
        .map(({ fileName, localHeaderOffset }) => ({
          fileName,
          localHeaderOffset,
        }))
        .slice(100),
      { length: 1000 },
    );
  } catch (error) {
    console.error("Error reading ZIP:", error);
  }
}

example();
