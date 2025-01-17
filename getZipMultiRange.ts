// this seems not to work. see https://community.cloudflare.com/t/multipart-http-range-requests-on-r2-not-working/665609

async function readFilesWithMultipartRanges(url, files) {
  // Estimate size needed for each file (header + data)
  const estimatedRanges = files.map((file) => {
    const start = file.localHeaderOffset;
    // Add buffer for local header (30 bytes) + name length + extra fields + compressed data
    const end = start + 1000 + file.compressedSize; // Adjust buffer size as needed
    return { start, end, file };
  });

  // Build the range header
  const rangeHeader = estimatedRanges
    .map((range) => `bytes=${range.start}-${range.end}`)
    .join(", ");

  // Make a single request with multiple ranges
  const response = await fetch(url, {
    headers: { Range: rangeHeader },
  });

  // The response will be multipart/byteranges with a specific boundary
  const contentType = response.headers.get("content-type");
  const boundary = contentType?.match(/boundary=([^;]+)/)?.[1];

  if (!boundary) {
    throw new Error("No boundary found in multipart response");
  }

  const responseText = await response.text();
  const parts = responseText.split(`--${boundary}`);

  // Process each part
  const results = [];
  for (const part of parts) {
    if (part.trim().length === 0 || part === "--") continue;

    // Parse the part headers and content
    const [headers, content] = part.trim().split("\r\n\r\n");
    const contentRange = headers.match(/Content-Range: bytes (\d+)-(\d+)/i);

    if (contentRange) {
      const startOffset = parseInt(contentRange[1]);
      const file = files.find((f) => f.localHeaderOffset === startOffset);

      if (file) {
        results.push({
          fileName: file.fileName,
          offset: startOffset,
          content: content,
        });
      }
    }
  }

  return results;
}

// Example usage
const files = [
  {
    fileName: "effect-main/packages/cli/examples/naval-fate.ts",
    localHeaderOffset: 128541,
    compressedSize: 1290,
  },
  {
    fileName: "effect-main/packages/cli/examples/naval-fate/domain.ts",
    localHeaderOffset: 130001,
    compressedSize: 598,
  },
];

try {
  const results = await readFilesWithMultipartRanges(
    "https://example.com/repo.zip",
    files,
  );
  for (const result of results) {
    console.log(`\n=== ${result.fileName} ===`);
    console.log(result.content.slice(0, 100) + "...");
  }
} catch (error) {
  console.error("Error reading files:", error);
}
