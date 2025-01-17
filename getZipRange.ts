async function readFileContent(url, localHeaderOffset, compressedSize) {
  // First read the local header (30 bytes fixed + filename length + extra field length)
  const response = await fetch(url, {
    headers: {
      Range: `bytes=${localHeaderOffset}-${localHeaderOffset + 30 - 1}`,
    },
  });

  const headerBuffer = await response.arrayBuffer();
  const headerView = new DataView(headerBuffer);

  // Verify local header signature (0x04034b50)
  if (headerView.getUint32(0, true) !== 0x04034b50) {
    throw new Error("Invalid local header signature");
  }

  const fileNameLength = headerView.getUint16(26, true);
  const extraFieldLength = headerView.getUint16(28, true);

  // Calculate where the actual file data starts
  const dataOffset = localHeaderOffset + 30 + fileNameLength + extraFieldLength;

  // Now read the actual compressed data
  const dataResponse = await fetch(url, {
    headers: {
      Range: `bytes=${dataOffset}-${dataOffset + compressedSize - 1}`,
    },
  });

  const compressedData = await dataResponse.arrayBuffer();
  return new Uint8Array(compressedData);
}

// Decompress DEFLATE data from ZIP format
async function decompressDeflate(compressed) {
  // Add zlib header (RFC 1950)
  const zlibHeader = new Uint8Array([0x78, 0x9c]); // Default compression level

  // Combine header and compressed data
  const withHeader = new Uint8Array(zlibHeader.length + compressed.length);
  withHeader.set(zlibHeader);
  withHeader.set(compressed, zlibHeader.length);

  // Use zlib format which is supported by DecompressionStream
  const ds = new DecompressionStream("zlib");
  const decompressedStream = new Blob([withHeader]).stream().pipeThrough(ds);
  const decompressedBuffer = await new Response(
    decompressedStream,
  ).arrayBuffer();
  return new Uint8Array(decompressedBuffer);
}

// Example usage:
async function example() {
  try {
    const zipUrl = "https://test.zipobject.com/repo.zip";
    const fileOffset = 128541; // "naval-fate.ts" offset
    const compressedSize = 1290; // from the central directory entry

    const compressedContent = await readFileContent(
      zipUrl,
      fileOffset,
      compressedSize,
    );
    console.log("Compressed content length:", compressedContent.length);
    console.log("First few bytes:", Array.from(compressedContent.slice(0, 10)));

    // Decompress the content
    const decompressed = await decompressDeflate(compressedContent);
    console.log("Decompressed content:");
    console.log(new TextDecoder().decode(decompressed));
  } catch (error) {
    console.error("Error:", error);
  }
}

example();
